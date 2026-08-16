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

/**
 * In-memory fake whose updateMany implements genuine compare-and-swap
 * semantics against the backing arrays, so the CAS behaviour under test is
 * the same "write only if the value is still what was scanned" rule the
 * real query expresses.
 */
function createFakeClient(rows: Row[], serviceInstances: ServiceInstanceRow[] = []) {
  return {
    rows,
    serviceInstances,
    credential: {
      findMany: jest.fn(
        async (args: { where: { decryptionKey: { not: null }; id?: { gt: string } }; take: number }): Promise<Row[]> =>
          rows
            .filter((row) => row.decryptionKey !== null)
            .filter((row) => (args.where.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({ id: row.id, decryptionKey: row.decryptionKey })),
      ),
      update: jest.fn(async () => {
        throw new Error('the rotation must never use unconditional update');
      }),
      updateMany: jest.fn(
        async (args: { where: { id: string; decryptionKey: string }; data: { decryptionKey: string } }) => {
          const row = rows.find((r) => r.id === args.where.id && r.decryptionKey === args.where.decryptionKey);
          if (!row) {
            return { count: 0 };
          }
          row.decryptionKey = args.data.decryptionKey;
          return { count: 1 };
        },
      ),
      findUnique: jest.fn(async (args: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === args.where.id);
        return row ? { id: row.id, decryptionKey: row.decryptionKey } : null;
      }),
    },
    serviceInstance: {
      findMany: jest.fn(
        async (args: { where?: { id?: { gt: string } }; take: number }): Promise<ServiceInstanceRow[]> =>
          serviceInstances
            .filter((row) => (args.where?.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({ id: row.id, config: row.config })),
      ),
      updateMany: jest.fn(async (args: { where: { id: string; config: string }; data: { config: string } }) => {
        const row = serviceInstances.find((r) => r.id === args.where.id && r.config === args.where.config);
        if (!row) {
          return { count: 0 };
        }
        row.config = args.data.config;
        return { count: 1 };
      }),
      findUnique: jest.fn(async (args: { where: { id: string } }) => {
        const row = serviceInstances.find((r) => r.id === args.where.id);
        return row ? { id: row.id, config: row.config } : null;
      }),
    },
  };
}

function expectNoWrites(client: ReturnType<typeof createFakeClient>) {
  expect(client.credential.updateMany).not.toHaveBeenCalled();
  expect(client.serviceInstance.updateMany).not.toHaveBeenCalled();
}

describe('rotateEncryptionKey', () => {
  it('rotates every outgoing envelope in both stores to values the active key opens, preserving plaintext and algorithm', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const configPlaintext = '{"url":"https://vc.example","headers":{"Authorization":"Bearer x"}}';
    const keyPlaintext = 'b'.repeat(64);
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, keyPlaintext) }];
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: await envelopeUnder(OUTGOING_KEY, configPlaintext) },
    ];
    const client = createFakeClient(rows, serviceInstances);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.blocked).toBe(false);
    expect(result.serviceInstances.outgoingOpened).toBe(1);
    expect(result.credentials.outgoingOpened).toBe(1);
    expect(result.serviceInstances.rotated).toBe(1);
    expect(result.credentials.rotated).toBe(1);

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
    const client = createFakeClient(rows, serviceInstances);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.serviceInstances.alreadyActive).toBe(1);
    expect(result.credentials.alreadyActive).toBe(1);
    expect(result.serviceInstances.rotated + result.credentials.rotated).toBe(0);
    expectNoWrites(client);
  });

  it('writes nothing when the two supplied keys are the same bytes in different hex case', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);

    const result = await rotateEncryptionKey(client, {
      activeService: await adapterFor(ACTIVE_KEY),
      outgoingService: await adapterFor(ACTIVE_KEY.toUpperCase()),
    });

    expect(result.credentials.alreadyActive).toBe(1);
    expectNoWrites(client);
  });

  it('rotates only the remainder on a re-run over a partially rotated store', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64)) },
    ];
    const client = createFakeClient(rows, []);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.alreadyActive).toBe(1);
    expect(result.credentials.rotated).toBe(1);
    expect(client.credential.updateMany).toHaveBeenCalledTimes(1);
  });

  it('aborts before any write when a valid envelope opens under neither key, naming every such row with both errors sampled', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(THIRD_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64)) },
    ];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: await envelopeUnder(THIRD_KEY, '{}') }];
    const client = createFakeClient(rows, serviceInstances);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.blocked).toBe(true);
    expect(result.serviceInstances.neitherKeyIds).toEqual(['svc-1']);
    expect(result.credentials.neitherKeyIds).toEqual(['cred-1']);
    expect(result.firstNeitherDecrypt?.rowDescription).toBe('service instance svc-1');
    expect((result.firstNeitherDecrypt?.activeError as { message?: unknown })?.message).toEqual(expect.any(String));
    expect((result.firstNeitherDecrypt?.outgoingError as { message?: unknown })?.message).toEqual(expect.any(String));
    expectNoWrites(client);
  });

  it('aborts before any write when a service configuration is not a valid envelope', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-bad', config: 'not an envelope' }];
    const client = createFakeClient(rows, serviceInstances);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.blocked).toBe(true);
    expect(result.serviceInstances.corruptedIds).toEqual(['svc-bad']);
    expectNoWrites(client);
  });

  it('rotates valid rows while leaving suspect credential values untouched', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const suspect = '{"cipherText":"tru';
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: suspect },
    ];
    const client = createFakeClient(rows, []);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.blocked).toBe(false);
    expect(result.credentials.rotated).toBe(1);
    expect(result.credentials.suspectRowIds).toEqual(['cred-2']);
    expect(rows[1].decryptionKey).toBe(suspect);
  });

  it('counts legacy plaintext keys without touching them', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'f'.repeat(64) },
      { id: 'cred-2', decryptionKey: null },
    ];
    const client = createFakeClient(rows, []);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.plaintextCount).toBe(1);
    expect(rows[0].decryptionKey).toBe('f'.repeat(64));
    expectNoWrites(client);
  });

  it('reports a row deleted between scan and write without failing the run', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany.mockImplementationOnce(async (args) => {
      rows.length = 0;
      return realUpdateMany(args);
    });

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.deletedIds).toEqual(['cred-1']);
    expect(result.credentials.rotated).toBe(0);
  });

  it('leaves a row alone and reports concurrent completion when another run already rotated it', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);
    const alreadyRotated = await envelopeUnder(ACTIVE_KEY, 'b'.repeat(64));
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany.mockImplementationOnce(async (args) => {
      rows[0].decryptionKey = alreadyRotated;
      return realUpdateMany(args);
    });

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.concurrentlyCompletedIds).toEqual(['cred-1']);
    expect(rows[0].decryptionKey).toBe(alreadyRotated);
  });

  it('re-rotates once from the fresh value when a row changed but still opens under the outgoing key', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);
    const rewritten = await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64));
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany.mockImplementationOnce(async (args) => {
      rows[0].decryptionKey = rewritten;
      return realUpdateMany(args);
    });

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.rotated).toBe(1);
    expect(result.credentials.conflictIds).toEqual([]);
    const fresh = await adapterFor(ACTIVE_KEY);
    expect(fresh.decrypt(JSON.parse(rows[0].decryptionKey as string))).toBe('c'.repeat(64));
  });

  it('never overwrites a row that changed into something it cannot rotate', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);
    const foreign = await envelopeUnder(THIRD_KEY, 'x'.repeat(64));
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany.mockImplementationOnce(async (args) => {
      rows[0].decryptionKey = foreign;
      return realUpdateMany(args);
    });

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.conflictIds).toEqual(['cred-1']);
    expect(rows[0].decryptionKey).toBe(foreign);
  });

  it('classifies a credential whose key was cleared mid-run as a conflict, not a deletion', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany.mockImplementationOnce(async (args) => {
      rows[0].decryptionKey = null;
      return realUpdateMany(args);
    });

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.conflictIds).toEqual(['cred-1']);
    expect(result.credentials.deletedIds).toEqual([]);
    expect(rows[0].decryptionKey).toBeNull();
  });

  it('never overwrites a service configuration that changed into something it cannot rotate', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: await envelopeUnder(OUTGOING_KEY, '{"a":1}') },
    ];
    const client = createFakeClient([], serviceInstances);
    const foreign = await envelopeUnder(THIRD_KEY, '{"b":2}');
    const realUpdateMany = client.serviceInstance.updateMany.getMockImplementation()!;
    client.serviceInstance.updateMany.mockImplementationOnce(async (args) => {
      serviceInstances[0].config = foreign;
      return realUpdateMany(args);
    });

    const result = await rotateEncryptionKey(client, await services());

    expect(result.serviceInstances.conflictIds).toEqual(['svc-1']);
    expect(serviceInstances[0].config).toBe(foreign);
  });

  it('names the failing row and the completed count when a write fails mid-run, and a re-run converges', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'c'.repeat(64)) },
    ];
    const client = createFakeClient(rows, []);
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany
      .mockImplementationOnce(realUpdateMany)
      .mockImplementationOnce(async () => {
        throw new Error('connection reset');
      })
      .mockImplementation(realUpdateMany);

    const error: Error = await rotateEncryptionKey(client, await services()).then(
      () => {
        throw new Error('expected the write failure to propagate');
      },
      (thrown: Error) => thrown,
    );
    expect(error.message).toContain('credential cred-2');
    expect(error.message).toContain('1 write(s) confirmed before the failure');

    const rerun = await rotateEncryptionKey(client, await services());
    expect(rerun.credentials.alreadyActive).toBe(1);
    expect(rerun.credentials.rotated).toBe(1);
  });

  it('propagates an active-service encrypt failure with the row named', async () => {
    const { rotateEncryptionKey } = await import('./rotate-encryption-key');
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnder(OUTGOING_KEY, 'b'.repeat(64)) }];
    const client = createFakeClient(rows, []);
    const real = await services();
    const failingActive = {
      decrypt: real.activeService.decrypt.bind(real.activeService),
      encrypt: () => {
        throw new Error('encrypt exploded');
      },
    };

    const error: Error = await rotateEncryptionKey(client, {
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
    const client = createFakeClient(rows, []);
    const events: string[] = [];
    const realUpdateMany = client.credential.updateMany.getMockImplementation()!;
    client.credential.updateMany.mockImplementation(async (args) => {
      events.push('write');
      return realUpdateMany(args);
    });

    await rotateEncryptionKey(client, await services(), {
      onPreflight: (summary) => {
        events.push(`preflight:${summary.credentials.alreadyActive}:${summary.credentials.outgoingOpened}`);
      },
    });
    expect(events).toEqual(['preflight:1:1', 'write']);

    const blockedClient = createFakeClient(
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

  it('paginates past a single batch in both stores', async () => {
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
    const client = createFakeClient(rows, serviceInstances);

    const result = await rotateEncryptionKey(client, await services());

    expect(result.credentials.alreadyActive).toBe(150);
    expect(result.serviceInstances.alreadyActive).toBe(120);
    expect(client.credential.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(client.serviceInstance.findMany.mock.calls.length).toBeGreaterThan(1);
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
    return {
      blocked: false,
      serviceInstances: {
        alreadyActive: 0,
        outgoingOpened: 0,
        rotated: 0,
        neitherKeyIds: [] as string[],
        deletedIds: [] as string[],
        concurrentlyCompletedIds: [] as string[],
        conflictIds: [] as string[],
        corruptedIds: [] as string[],
      },
      credentials: {
        alreadyActive: 0,
        outgoingOpened: 0,
        rotated: 0,
        neitherKeyIds: [] as string[],
        deletedIds: [] as string[],
        concurrentlyCompletedIds: [] as string[],
        conflictIds: [] as string[],
        suspectRowIds: [] as string[],
        plaintextCount: 0,
      },
    };
  }

  it('exits 0 and reports completion when everything ended under the active key', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.serviceInstances.outgoingOpened = 2;
    result.serviceInstances.rotated = 2;
    result.credentials.alreadyActive = 3;

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('Rotation complete');
  });

  it('exits 1 on a blocked run, naming ids on stderr with both sampled errors', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.blocked = true;
    result.serviceInstances.corruptedIds = ['svc-bad'];
    result.credentials.neitherKeyIds = ['cred-1', 'cred-2'];
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
    result.credentials.outgoingOpened = 4;
    result.credentials.rotated = 4;
    result.credentials.suspectRowIds = ['cred-odd'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(1);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('rotated from the outgoing key: 4');
    expect(text).toContain('finished incomplete');
  });

  it('exits 1 when conflicts or deletes occurred', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.serviceInstances.outgoingOpened = 1;
    result.serviceInstances.rotated = 1;
    result.credentials.outgoingOpened = 1;
    result.credentials.conflictIds = ['cred-racy'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(1);
    expect(report.lines.map((l) => l.text).join('\n')).toContain('cred-racy');
  });

  it('states that nothing was rotated and hints at reversed variables when only the active key opened envelopes', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.credentials.alreadyActive = 5;

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
    result.credentials.outgoingOpened = 2;
    result.credentials.concurrentlyCompletedIds = ['cred-1', 'cred-2'];

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).not.toContain('The outgoing key opened nothing');
    expect(text).not.toContain('neither key was proven');
  });

  it('prints the nothing-to-verify note on empty or plaintext-only stores, exiting 0', async () => {
    const { buildRotationReport } = await import('./rotate-encryption-key');
    const result = baseResult();
    result.credentials.plaintextCount = 3;

    const report = buildRotationReport(result, DOCS);

    expect(report.exitCode).toBe(0);
    const text = report.lines.map((line) => line.text).join('\n');
    expect(text).toContain('neither key was proven');
    expect(text).toContain('backfill:decryption-keys');
    expect(text).not.toContain('Rotation complete');
    expect(text).toContain('Nothing was modified.');
  });
});
