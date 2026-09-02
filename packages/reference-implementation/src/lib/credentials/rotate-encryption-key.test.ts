export {};

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const ACTIVE_KEY = 'a'.repeat(64);
const OUTGOING_KEY = 'd'.repeat(64);
const THIRD_KEY = 'e'.repeat(64);

type Row = { id: string; decryptionKey: string | null };
type ServiceInstanceRow = { id: string; config: string };

const fakeLogger = () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger as never;
};

async function adapterFor(key: string) {
  const { AesGcmEncryptionAdapter } = await import('@uncefact/untp-ri-services/encryption');
  return new AesGcmEncryptionAdapter(key, fakeLogger());
}

async function envelopeUnder(key: string, plaintext: string): Promise<string> {
  const { EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');
  return JSON.stringify((await adapterFor(key)).encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM));
}

async function services() {
  return { activeService: await adapterFor(ACTIVE_KEY), outgoingService: await adapterFor(OUTGOING_KEY) };
}

import { fakeStores as sharedFakeStores } from './envelope-stores.fake';

/** This suite's row order: credentials first, then service instances, then replay bodies. */
function fakeStores(
  rows: Row[],
  serviceInstances: ServiceInstanceRow[] = [],
  replayRows: { id: string; responseBody: string | null }[] = [],
) {
  return sharedFakeStores(serviceInstances, rows, replayRows);
}

function expectNoWrites(stores: ReturnType<typeof fakeStores>) {
  for (const store of Object.values(stores)) {
    expect(store.casWrite).not.toHaveBeenCalled();
  }
}

describe('rotateEncryptionKey', () => {
  it('rotates idempotency replay bodies with the other stores', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const svc = await services();
    const replayRows = [{ id: 'claim-1', responseBody: await envelopeUnder(OUTGOING_KEY, '["w"]') }];
    const stores = fakeStores([], [], replayRows);

    const result = await rotateEncryptionKey(stores, svc);

    expect(result.blocked).toBe(false);
    expect(result.stores.idempotencyResponses).toMatchObject({ outgoingOpened: 1, rotated: 1 });
    const { parseEnvelope } = await import('./decryption-key-protection');
    expect(svc.activeService.decrypt(parseEnvelope(replayRows[0].responseBody as string)!)).toBe('["w"]');
  });

  it('clears a damaged or unopenable replay body, keeping the row, and rotates everything else', async () => {
    const { rotateEncryptionKey, buildRotationReport } = await import('./rotate-encryption-key');
    const svc = await services();
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const replayRows = [
      { id: 'claim-bad', responseBody: '["plain"]' },
      { id: 'claim-third', responseBody: await envelopeUnder(THIRD_KEY, '[]') },
      { id: 'claim-ok', responseBody: await envelopeUnder(OUTGOING_KEY, '["w"]') },
    ];
    const stores = fakeStores(rows, [], replayRows);
    const onPreflight = jest.fn();

    const result = await rotateEncryptionKey(stores, svc, { onPreflight });

    expect(result.blocked).toBe(false);
    expect(result.stores.credentials.rotated).toBe(1);
    expect(result.stores.idempotencyResponses).toMatchObject({
      corruptedIds: ['claim-bad'],
      neitherKeyIds: ['claim-third'],
      clearedIds: ['claim-bad', 'claim-third'],
      rotated: 1,
    });
    expect(onPreflight.mock.calls[0][0].idempotencyResponses).toMatchObject({ toClear: 2, outgoingOpened: 1 });
    // The value is gone, the rows are not: the claims still guard against a second issuance.
    expect(replayRows.map((row) => [row.id, row.responseBody === null])).toEqual([
      ['claim-bad', true],
      ['claim-third', true],
      ['claim-ok', false],
    ]);
    expect(stores.idempotencyResponses.discard).toHaveBeenCalledTimes(2);

    const report = buildRotationReport(result, 'https://docs.example/rotation');
    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('cleared, the rows kept (2): claim-bad, claim-third');
    expect(text).toContain('Rotation complete');
  });

  it('reports a replay body it could not clear as a conflict and the run as incomplete', async () => {
    const { rotateEncryptionKey, buildRotationReport } = await import('./rotate-encryption-key');
    const replayRows = [{ id: 'claim-third', responseBody: await envelopeUnder(THIRD_KEY, '[]') }];
    const stores = fakeStores([], [], replayRows);
    const realDiscard = stores.idempotencyResponses.discard.getMockImplementation()!;
    stores.idempotencyResponses.discard.mockImplementationOnce(async (...args) => {
      replayRows[0].responseBody = '{"rewritten":true}';
      return realDiscard(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.idempotencyResponses).toMatchObject({
      neitherKeyIds: ['claim-third'],
      clearedIds: [],
      conflictIds: ['claim-third'],
    });
    expect(buildRotationReport(result, 'https://docs.example/rotation').exitCode).toBe(1);
  });

  it('says what it cleared when the outgoing key opened nothing', async () => {
    const { rotateEncryptionKey, buildRotationReport } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, [], [{ id: 'claim-bad', responseBody: '["plain"]' }]);

    const result = await rotateEncryptionKey(stores, await services());
    const text = buildRotationReport(result, 'https://docs.example/rotation')
      .lines.map((line) => line.text)
      .join('\n');

    expect(text).toContain('Nothing was rotated; 1 unreadable value(s) cleared.');
  });

  it('says what it cleared when nothing opened under either key', async () => {
    const { rotateEncryptionKey, buildRotationReport } = await import('./rotate-encryption-key');
    const stores = fakeStores([], [], [{ id: 'claim-bad', responseBody: '["plain"]' }]);

    const result = await rotateEncryptionKey(stores, await services());
    const report = buildRotationReport(result, 'https://docs.example/rotation');

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('Nothing was rotated; 1 unreadable value(s) cleared.');
    expect(text).not.toContain('Nothing was modified.');
  });

  it('rotates every outgoing envelope in two stores to values the active key opens, preserving plaintext and algorithm', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const configPlaintext = '{"url":"https://vc.example","headers":{"Authorization":"Bearer x"}}';
    const keyPlaintext = 'b'.repeat(64);
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, keyPlaintext) }];
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: await envelopeUnder(OUTGOING_KEY, configPlaintext) },
    ];
    const stores = fakeStores(rows, serviceInstances);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.blocked).toBe(false);
    expect(result.stores.serviceInstances.outgoingOpened).toBe(1);
    expect(result.stores.credentials.outgoingOpened).toBe(1);
    expect(result.stores.serviceInstances.rotated).toBe(1);
    expect(result.stores.credentials.rotated).toBe(1);

    // Round-trip with a FRESH active adapter: the stored value is a
    // stringified envelope, its algorithm is preserved, and the plaintext
    // is byte-identical to the original.
    const fresh = await adapterFor(ACTIVE_KEY);
    const rotatedConfig = JSON.parse(serviceInstances[0].config);
    expect(rotatedConfig.type).toBe('aes-256-gcm');
    expect(fresh.decrypt(rotatedConfig)).toBe(configPlaintext);
    expect(fresh.decrypt(JSON.parse(rows[0].decryptionKey as string))).toBe(keyPlaintext);

    // And a genuinely different key no longer opens it.
    const third = await adapterFor(THIRD_KEY);
    expect(() => third.decrypt(rotatedConfig)).toThrow();
  });

  it('writes nothing when every envelope is already under the active key', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64)) }];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: await envelopeUnder(ACTIVE_KEY, '{}') }];
    const stores = fakeStores(rows, serviceInstances);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.serviceInstances.alreadyActive).toBe(1);
    expect(result.stores.credentials.alreadyActive).toBe(1);
    expect(result.stores.serviceInstances.rotated + result.stores.credentials.rotated).toBe(0);
    expectNoWrites(stores);
  });

  it('writes nothing when the two supplied keys are the same bytes in different hex case', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);

    const result = await rotateEncryptionKey(stores, {
      activeService: await adapterFor(ACTIVE_KEY),
      outgoingService: await adapterFor(ACTIVE_KEY.toUpperCase()),
    });

    expect(result.stores.credentials.alreadyActive).toBe(1);
    expectNoWrites(stores);
  });

  it('rotates only the remainder on a re-run over a partially rotated store', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64)) },
    ];
    const stores = fakeStores(rows, []);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.alreadyActive).toBe(1);
    expect(result.stores.credentials.rotated).toBe(1);
    expect(stores.credentials.casWrite).toHaveBeenCalledTimes(1);
  });

  it('aborts before any write when a valid envelope opens under neither key, naming every such row with both errors sampled', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(THIRD_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64)) },
    ];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: await envelopeUnder(THIRD_KEY, '{}') }];
    const stores = fakeStores(rows, serviceInstances);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.blocked).toBe(true);
    expect(result.stores.serviceInstances.neitherKeyIds).toEqual(['svc-1']);
    expect(result.stores.credentials.neitherKeyIds).toEqual(['cred-1']);
    expect(result.firstNeitherDecrypt?.rowDescription).toBe('service instance svc-1');
    expect((result.firstNeitherDecrypt?.activeError as { message?: unknown })?.message).toEqual(expect.any(String));
    expect((result.firstNeitherDecrypt?.outgoingError as { message?: unknown })?.message).toEqual(expect.any(String));
    expectNoWrites(stores);
  });

  it('aborts before any write when a service configuration is not a valid envelope', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-bad', config: 'not an envelope' }];
    const stores = fakeStores(rows, serviceInstances);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.blocked).toBe(true);
    expect(result.stores.serviceInstances.corruptedIds).toEqual(['svc-bad']);
    expectNoWrites(stores);
  });

  it('rotates valid rows while leaving suspect credential values untouched', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const suspect = '{"cipherText":"tru';
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: suspect },
    ];
    const stores = fakeStores(rows, []);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.blocked).toBe(false);
    expect(result.stores.credentials.rotated).toBe(1);
    expect(result.stores.credentials.suspectRowIds).toEqual(['cred-2']);
    expect(rows[1].decryptionKey).toBe(suspect);
  });

  it('counts legacy plaintext keys without touching them', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'f'.repeat(64) },
      { id: 'cred-2', decryptionKey: null },
    ];
    const stores = fakeStores(rows, []);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.plaintextCount).toBe(1);
    expect(rows[0].decryptionKey).toBe('f'.repeat(64));
    expectNoWrites(stores);
  });

  it('reports a row deleted between scan and write without failing the run', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite.mockImplementationOnce(async (...args) => {
      rows.length = 0;
      return realCasWrite(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.deletedIds).toEqual(['cred-1']);
    expect(result.stores.credentials.rotated).toBe(0);
  });

  it('leaves a row alone and reports concurrent completion when another run already rotated it', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);
    const alreadyRotated = await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64));
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite.mockImplementationOnce(async (...args) => {
      rows[0].decryptionKey = alreadyRotated;
      return realCasWrite(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.concurrentlyCompletedIds).toEqual(['cred-1']);
    expect(rows[0].decryptionKey).toBe(alreadyRotated);
  });

  it('re-rotates once from the fresh value when a row changed but still opens under the outgoing key', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);
    const rewritten = await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64));
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite.mockImplementationOnce(async (...args) => {
      rows[0].decryptionKey = rewritten;
      return realCasWrite(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.rotated).toBe(1);
    expect(result.stores.credentials.conflictIds).toEqual([]);
    const fresh = await adapterFor(ACTIVE_KEY);
    expect(fresh.decrypt(JSON.parse(rows[0].decryptionKey as string))).toBe('c'.repeat(64));
  });

  it('never overwrites a row that changed into something it cannot rotate', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);
    const foreign = await envelopeUnder(THIRD_KEY, 'x'.repeat(64));
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite.mockImplementationOnce(async (...args) => {
      rows[0].decryptionKey = foreign;
      return realCasWrite(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.conflictIds).toEqual(['cred-1']);
    expect(rows[0].decryptionKey).toBe(foreign);
  });

  it('classifies a credential whose key was cleared mid-run as a conflict, not a deletion', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite.mockImplementationOnce(async (...args) => {
      rows[0].decryptionKey = null;
      return realCasWrite(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.conflictIds).toEqual(['cred-1']);
    expect(result.stores.credentials.deletedIds).toEqual([]);
    expect(rows[0].decryptionKey).toBeNull();
  });

  it('never overwrites a service configuration that changed into something it cannot rotate', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: await envelopeUnder(OUTGOING_KEY, '{"a":1}') },
    ];
    const stores = fakeStores([], serviceInstances);
    const foreign = await envelopeUnder(THIRD_KEY, '{"b":2}');
    const realCasWrite = stores.serviceInstances.casWrite.getMockImplementation()!;
    stores.serviceInstances.casWrite.mockImplementationOnce(async (...args) => {
      serviceInstances[0].config = foreign;
      return realCasWrite(...args);
    });

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.serviceInstances.conflictIds).toEqual(['svc-1']);
    expect(serviceInstances[0].config).toBe(foreign);
  });

  it('names the failing row and the completed count when a write fails mid-run, and a re-run converges', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64)) },
    ];
    const stores = fakeStores(rows, []);
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite
      .mockImplementationOnce(realCasWrite)
      .mockImplementationOnce(async () => {
        throw new Error('connection reset');
      })
      .mockImplementation(realCasWrite);

    const error: Error = await rotateEncryptionKey(stores, await services()).then(
      () => {
        throw new Error('expected the write failure to propagate');
      },
      (thrown: Error) => thrown,
    );
    expect(error.message).toContain('credential cred-2');
    expect(error.message).toContain('1 write(s) confirmed before the failure');

    const rerun = await rotateEncryptionKey(stores, await services());
    expect(rerun.stores.credentials.alreadyActive).toBe(1);
    expect(rerun.stores.credentials.rotated).toBe(1);
  });

  it('propagates an active-service encrypt failure with the row named', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const stores = fakeStores(rows, []);
    const real = await services();
    const failingActive = {
      decrypt: real.activeService.decrypt.bind(real.activeService),
      encrypt: () => {
        throw new Error('encrypt exploded');
      },
    };

    const error: Error = await rotateEncryptionKey(stores, {
      activeService: failingActive,
      outgoingService: real.outgoingService,
    }).then(
      () => {
        throw new Error('expected the encrypt failure to propagate');
      },
      (thrown: Error) => thrown,
    );
    expect(error.message).toContain('credential cred-1');
    expect(error.message).toContain('no write had been confirmed');
    expect(rows[0].decryptionKey).toContain('cipherText');
  });

  it('invokes onPreflight once, before the first write, and not on blocked runs', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'c'.repeat(64)) },
    ];
    const stores = fakeStores(rows, []);
    const events: string[] = [];
    const realCasWrite = stores.credentials.casWrite.getMockImplementation()!;
    stores.credentials.casWrite.mockImplementation(async (...args) => {
      events.push('write');
      return realCasWrite(...args);
    });

    await rotateEncryptionKey(stores, await services(), {
      onPreflight: (summary) => {
        events.push(`preflight:${summary.credentials.alreadyActive}:${summary.credentials.outgoingOpened}`);
      },
    });
    expect(events).toEqual(['preflight:1:1', 'write']);

    const blockedClient = fakeStores(
      [{ id: 'cred-bad', decryptionKey: await envelopeUnder(THIRD_KEY, 'd'.repeat(64)) }],
      [],
    );
    const blockedEvents: string[] = [];
    const blocked = await rotateEncryptionKey(blockedClient, await services(), {
      onPreflight: () => blockedEvents.push('preflight'),
    });
    expect(blocked.blocked).toBe(true);
    expect(blockedEvents).toEqual([]);
  });

  it('classifies many rows in two stores', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const active = await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64));
    const rows: Row[] = Array.from({ length: 150 }, (_, index) => ({
      id: `cred-${String(index).padStart(3, '0')}`,
      decryptionKey: active,
    }));
    const activeConfig = await envelopeUnder(ACTIVE_KEY, '{}');
    const serviceInstances: ServiceInstanceRow[] = Array.from({ length: 120 }, (_, index) => ({
      id: `svc-${String(index).padStart(3, '0')}`,
      config: activeConfig,
    }));
    const stores = fakeStores(rows, serviceInstances);

    const result = await rotateEncryptionKey(stores, await services());

    expect(result.stores.credentials.alreadyActive).toBe(150);
    expect(result.stores.serviceInstances.alreadyActive).toBe(120);
  });
});

describe('validateRotationKeys', () => {
  const PLACEHOLDER = '0'.repeat(64);

  async function validate(env: Record<string, string | undefined>) {
    const { validateRotationKeys } = await import('./rotate-encryption-key');
    return validateRotationKeys(env, fakeLogger());
  }

  it('names the missing active variable', async () => {
    const result = await validate({ OUTGOING_DATA_ENCRYPTION_KEY: OUTGOING_KEY });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('DATA_ENCRYPTION_KEY (the new key)') });
  });

  it('names the missing outgoing variable rather than failing on a generic format message', async () => {
    const result = await validate({ DATA_ENCRYPTION_KEY: ACTIVE_KEY });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('OUTGOING_DATA_ENCRYPTION_KEY (the previous key) is not set'),
    });
  });

  it.each([
    [
      'active',
      { DATA_ENCRYPTION_KEY: 'zz'.repeat(32), OUTGOING_DATA_ENCRYPTION_KEY: OUTGOING_KEY },
      'DATA_ENCRYPTION_KEY (the new key) is invalid',
    ],
    [
      'outgoing',
      { DATA_ENCRYPTION_KEY: ACTIVE_KEY, OUTGOING_DATA_ENCRYPTION_KEY: 'too-short' },
      'OUTGOING_DATA_ENCRYPTION_KEY (the previous key) is invalid',
    ],
  ])('names the %s variable when its key fails the 64-hex format rule', async (_name, env, expected) => {
    const result = await validate(env);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain(expected);
  });

  it('refuses a placeholder active key outside local development', async () => {
    const result = await validate({
      DATA_ENCRYPTION_KEY: PLACEHOLDER,
      OUTGOING_DATA_ENCRYPTION_KEY: OUTGOING_KEY,
      DEPLOYMENT_ENVIRONMENT: 'production',
    });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('placeholder');
  });

  it('allows a placeholder active key in local development', async () => {
    const result = await validate({
      DATA_ENCRYPTION_KEY: PLACEHOLDER,
      OUTGOING_DATA_ENCRYPTION_KEY: OUTGOING_KEY,
      DEPLOYMENT_ENVIRONMENT: 'local',
    });
    expect(result.ok).toBe(true);
    expect((result as { warnings: string[] }).warnings.join('\n')).toContain('placeholder');
  });

  it('warns, in every environment, when the outgoing key is the published placeholder', async () => {
    const result = await validate({
      DATA_ENCRYPTION_KEY: ACTIVE_KEY,
      OUTGOING_DATA_ENCRYPTION_KEY: PLACEHOLDER,
      DEPLOYMENT_ENVIRONMENT: 'production',
    });
    expect(result.ok).toBe(true);
    expect((result as { warnings: string[] }).warnings.join('\n')).toContain('placeholder');
  });

  it('warns when the two keys are the same bytes in different hex case', async () => {
    const result = await validate({
      DATA_ENCRYPTION_KEY: ACTIVE_KEY,
      OUTGOING_DATA_ENCRYPTION_KEY: ACTIVE_KEY.toUpperCase(),
    });
    expect(result.ok).toBe(true);
    expect((result as { warnings: string[] }).warnings.join('\n')).toContain('identical');
  });

  it('returns working adapters: the active service round-trips what the outgoing service wrote', async () => {
    const result = await validate({ DATA_ENCRYPTION_KEY: ACTIVE_KEY, OUTGOING_DATA_ENCRYPTION_KEY: OUTGOING_KEY });
    expect(result.ok).toBe(true);
    const { services } = result as { services: { activeService: { encrypt: Function; decrypt: Function } } };
    const { EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');
    const envelope = services.activeService.encrypt('round-trip', EncryptionAlgorithm.AES_256_GCM);
    expect(services.activeService.decrypt(envelope)).toBe('round-trip');
  });
});

describe('buildRotationReport', () => {
  const DOCS = 'https://docs.example/rotation';

  function baseResult() {
    const store = () => ({
      alreadyActive: 0,
      outgoingOpened: 0,
      rotated: 0,
      neitherKeyIds: [] as string[],
      deletedIds: [] as string[],
      concurrentlyCompletedIds: [] as string[],
      conflictIds: [] as string[],
      corruptedIds: [] as string[],
      clearedIds: [] as string[],
      suspectRowIds: [] as string[],
      plaintextCount: 0,
    });
    return {
      blocked: false,
      stores: {
        serviceInstances: store(),
        credentials: store(),
        idempotencyResponses: store(),
      },
    };
  }

  it('reports the replay-body store with the other two, and unreadable rows a run could not clear with the remedy', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.serviceInstances.alreadyActive = 1;
    result.stores.idempotencyResponses.neitherKeyIds = ['claim-1'];
    result.stores.idempotencyResponses.corruptedIds = ['claim-2'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(1);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('Idempotency replay bodies:');
    const errText = report.lines
      .filter((line) => line.stream === 'err')
      .map((line) => line.text)
      .join('\n');
    expect(errText).toContain('decrypted under neither supplied key (1): claim-1');
    expect(errText).toContain('not a valid encrypted envelope (1): claim-2');
    expect(errText).toContain('some could not be cleared this run; clear the replay body of the affected claims');
    expect(errText).toContain('Run finished incomplete');
  });

  it('exits 0 and reports completion when everything ended under the active key', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.serviceInstances.outgoingOpened = 2;
    result.stores.serviceInstances.rotated = 2;
    result.stores.credentials.alreadyActive = 3;

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('Rotation complete');
  });

  it('exits 1 on a blocked run, naming ids on stderr with both sampled errors', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.blocked = true;
    result.stores.serviceInstances.corruptedIds = ['svc-bad'];
    result.stores.credentials.neitherKeyIds = ['cred-1', 'cred-2'];
    (result as Record<string, unknown>).firstNeitherDecrypt = {
      rowDescription: 'credential cred-1',
      activeError: new Error('active boom'),
      outgoingError: new Error('outgoing boom'),
    };

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(1);
    const errText = report.lines
      .filter((line) => line.stream === 'err')
      .map((line) => line.text)
      .join('\n');
    expect(errText).toContain('svc-bad');
    expect(errText).toContain('cred-1, cred-2');
    expect(errText).toContain('active boom');
    expect(errText).toContain('outgoing boom');
    expect(errText).toContain('aborted before any write');
    expect(errText).not.toContain('key mismatch');
  });

  it('exits 1 incomplete when suspects remain, while still reporting the rotated count', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.credentials.outgoingOpened = 4;
    result.stores.credentials.rotated = 4;
    result.stores.credentials.suspectRowIds = ['cred-odd'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(1);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('rotated from the outgoing key: 4');
    expect(text).toContain('finished incomplete');
  });

  it('exits 1 when conflicts or deletes occurred', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.serviceInstances.outgoingOpened = 1;
    result.stores.serviceInstances.rotated = 1;
    result.stores.credentials.outgoingOpened = 1;
    result.stores.credentials.conflictIds = ['cred-racy'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(1);
    expect(report.lines.map((l) => l.text).join('\n')).toContain('cred-racy');
  });

  it('states that nothing was rotated and hints at reversed variables when only the active key opened envelopes', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.credentials.alreadyActive = 5;

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('The outgoing key opened nothing');
    expect(text).toContain('not reversed');
    expect(text).not.toContain('Rotation complete');
  });

  it('does not print the reversed-keys note or nothing-to-verify when candidates were concurrently completed', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.credentials.outgoingOpened = 2;
    result.stores.credentials.concurrentlyCompletedIds = ['cred-1', 'cred-2'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).not.toContain('The outgoing key opened nothing');
    expect(text).not.toContain('neither key was proven');
  });

  it('prints the nothing-to-verify note on empty or plaintext-only stores, exiting 0', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.stores.credentials.plaintextCount = 3;

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('neither key was proven');
    expect(text).toContain('backfill:decryption-keys');
    expect(text).not.toContain('Rotation complete');
    expect(text).toContain('Nothing was modified.');
  });
});
