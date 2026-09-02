export {};

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const originalEnv = process.env;

const ACTIVE_KEY = 'a'.repeat(64);
const OTHER_KEY = 'd'.repeat(64);

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, DATA_ENCRYPTION_KEY: ACTIVE_KEY };
});

afterAll(() => {
  process.env = originalEnv;
});

type Row = { id: string; decryptionKey: string | null };
type ServiceInstanceRow = { id: string; config: string };

type ReplayRow = { id: string; responseBody: string | null };

/**
 * An in-memory table for one encrypted column. `findMany` applies the
 * filters the registry actually sends (`not: null`, `startsWith`, the id
 * cursor and `take`), so a test proves the production query shape rather
 * than receiving canned data, and `updateMany` implements genuine
 * compare-and-swap against the backing array.
 */
function fakeTable<Column extends string, R extends { id: string } & Record<Column, string | null>>(
  rows: R[],
  column: Column,
) {
  type Filter = { not?: null; startsWith?: string } | undefined;
  const matching = (args: { where?: Record<string, unknown>; take: number }) => {
    const filter = args.where?.[column] as Filter;
    const cursor = args.where?.id as { gt: string } | undefined;
    return rows
      .filter((row) => (filter !== undefined && 'not' in filter ? row[column] !== null : true))
      .filter((row) => (filter?.startsWith !== undefined ? row[column]?.startsWith(filter.startsWith) ?? false : true))
      .filter((row) => (cursor ? row.id > cursor.gt : true))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, args.take);
  };
  return {
    findMany: jest.fn(async (args: { where?: Record<string, unknown>; take: number }) =>
      matching(args).map((row) => ({ id: row.id, [column]: row[column] }) as { id: string } & Pick<R, Column>),
    ),
    updateMany: jest.fn(
      async (args: { where: { id: string } & Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === args.where.id && r[column] === args.where[column]);
        if (!row) {
          return { count: 0 };
        }
        row[column] = args.data[column] as R[Column];
        return { count: 1 };
      },
    ),
    findUnique: jest.fn(async (args: { where: { id: string } }) => {
      const row = rows.find((r) => r.id === args.where.id);
      return row ? ({ id: row.id, [column]: row[column] } as { id: string } & Pick<R, Column>) : null;
    }),
  };
}

function createFakeClient(rows: Row[], serviceInstances: ServiceInstanceRow[] = [], replayRows: ReplayRow[] = []) {
  return {
    serviceInstance: fakeTable(serviceInstances, 'config'),
    credential: {
      ...fakeTable(rows, 'decryptionKey'),
      update: jest.fn(async (args: { where: { id: string }; data: { decryptionKey: string } }) => {
        const row = rows.find((candidate) => candidate.id === args.where.id);
        if (!row) {
          // Mirrors Prisma's record-not-found failure (PrismaClientKnownRequestError, code P2025).
          throw Object.assign(new Error(`Record to update not found: ${args.where.id}`), { code: 'P2025' });
        }
        row.decryptionKey = args.data.decryptionKey;
        return row;
      }),
    },
    idempotencyKey: fakeTable(replayRows, 'responseBody'),
  };
}

/** An envelope produced under a key other than the active DATA_ENCRYPTION_KEY. */
async function envelopeUnderOtherKey(plaintext: string): Promise<string> {
  const { AesGcmEncryptionAdapter, EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const adapter = new AesGcmEncryptionAdapter(OTHER_KEY, logger as never);
  return JSON.stringify(adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM));
}

describe('backfillDecryptionKeys', () => {
  it('wraps plaintext keys in place and reports counts', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey, revealDecryptionKey, isProtectedDecryptionKey } = await import(
      './decryption-key-protection'
    );

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: protectDecryptionKey('c'.repeat(64)) },
      { id: 'cred-3', decryptionKey: null },
    ];
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client);

    expect(result).toEqual({
      wrapped: 1,
      alreadyProtected: 1,
      keyVerified: true,
      suspectRowIds: [],
      deletedRowIds: [],
      preflightNotes: [],
    });
    expect(isProtectedDecryptionKey(rows[0].decryptionKey as string)).toBe(true);
    expect(revealDecryptionKey(rows[0].decryptionKey)).toBe('b'.repeat(64));
    expect(revealDecryptionKey(rows[1].decryptionKey)).toBe('c'.repeat(64));
    expect(rows[2].decryptionKey).toBeNull();
  });

  it('refuses to wrap when no envelope exists to verify the key against', async () => {
    const { backfillDecryptionKeys, KeyUnverifiedError } = await import('./backfill-decryption-keys');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: 'c'.repeat(64) },
    ];
    const client = createFakeClient(rows);

    await expect(backfillDecryptionKeys(client)).rejects.toThrow(KeyUnverifiedError);
    expect(client.credential.update).not.toHaveBeenCalled();
    expect(rows[0].decryptionKey).toBe('b'.repeat(64));
  });

  it('wraps unverified plaintext when force is passed, reporting the key as unverified', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { isProtectedDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: 'c'.repeat(64) },
    ];
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client, { force: true });

    expect(result).toEqual({
      wrapped: 2,
      alreadyProtected: 0,
      keyVerified: false,
      suspectRowIds: [],
      deletedRowIds: [],
      preflightNotes: [],
    });
    expect(rows.every((row) => isProtectedDecryptionKey(row.decryptionKey as string))).toBe(true);
  });

  it('succeeds without force when there is nothing to wrap and nothing to verify against', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const client = createFakeClient([{ id: 'cred-1', decryptionKey: null }]);

    const result = await backfillDecryptionKeys(client);

    expect(result).toEqual({
      wrapped: 0,
      alreadyProtected: 0,
      keyVerified: false,
      suspectRowIds: [],
      deletedRowIds: [],
      preflightNotes: [],
    });
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('verifies the key against a service instance configuration when no credential envelope exists', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey, isProtectedDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: protectDecryptionKey('{"apiUrl":"x"}') }];
    const client = createFakeClient(rows, serviceInstances);

    const result = await backfillDecryptionKeys(client);

    expect(result.keyVerified).toBe(true);
    expect(result.wrapped).toBe(1);
    expect(isProtectedDecryptionKey(rows[0].decryptionKey as string)).toBe(true);
  });

  it('refuses to wrap a plaintext row inserted after an empty unverified preflight', async () => {
    const { backfillDecryptionKeys, KeyUnverifiedError } = await import('./backfill-decryption-keys');

    const rows: Row[] = [];
    const client = createFakeClient(rows);
    const passThrough = client.credential.findMany.getMockImplementation()!;
    client.credential.findMany
      // Preflight scan: nothing exists yet, so no force is demanded up front.
      .mockImplementationOnce(async () => [])
      // Wrap scan: an old replica has inserted a plaintext row in between.
      .mockImplementation(async (args) => {
        if (rows.length === 0) rows.push({ id: 'cred-late', decryptionKey: 'b'.repeat(64) });
        return passThrough(args);
      });

    await expect(backfillDecryptionKeys(client)).rejects.toThrow(KeyUnverifiedError);
    expect(client.credential.update).not.toHaveBeenCalled();
    expect(rows[0].decryptionKey).toBe('b'.repeat(64));
  });

  it('aborts on a corrupted service instance configuration, with or without force', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }];
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: protectDecryptionKey('{"apiUrl":"x"}') },
      { id: 'svc-2', config: '{"cipherText":"tru' },
    ];

    const client = createFakeClient(rows, serviceInstances);
    await expect(backfillDecryptionKeys(client)).rejects.toThrow('svc-2');
    expect(client.credential.update).not.toHaveBeenCalled();

    const forcedClient = createFakeClient(rows, serviceInstances);
    await expect(backfillDecryptionKeys(forcedClient, { force: true })).rejects.toThrow('svc-2');
    expect(forcedClient.credential.update).not.toHaveBeenCalled();
    expect(rows[0].decryptionKey).toBe('b'.repeat(64));
  });

  it('aborts on a service instance configuration with every required key but null fields, not a confusing crypto error', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    // Has cipherText/iv/tag/type — a presence-only envelope check would
    // wrongly call this protected, attempt to decrypt it, and abort with a
    // crypto error ("Unsupported algorithm: null") that reads as a key
    // problem. It must instead be classified as "not a valid envelope" up
    // front, hitting the backfill's existing, accurate abort message.
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }];
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-1', config: '{"cipherText":null,"iv":null,"tag":null,"type":null}' },
    ];
    const client = createFakeClient(rows, serviceInstances);

    await expect(backfillDecryptionKeys(client)).rejects.toThrow(
      'Preflight found service instance(s) svc-1 whose configuration is not a valid encrypted envelope',
    );
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('aborts on a service instance configuration whose IV is valid Base64 but the wrong decoded length', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    // Valid Base64, right shape, right algorithm — but the IV is 8 decoded
    // bytes, not the 12 AES-256-GCM requires. Node does not reject this at
    // construction, and the eventual failure throws the exact same error a
    // genuinely wrong key produces, so this can only be caught structurally.
    const rows: Row[] = [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }];
    const tampered = JSON.parse(protectDecryptionKey('{"apiUrl":"x"}') as string);
    tampered.iv = Buffer.from('12345678').toString('base64');
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: JSON.stringify(tampered) }];
    const client = createFakeClient(rows, serviceInstances);

    await expect(backfillDecryptionKeys(client)).rejects.toThrow(
      'Preflight found service instance(s) svc-1 whose configuration is not a valid encrypted envelope',
    );
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('aborts before writing when a service instance configuration cannot be decrypted', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: await envelopeUnderOtherKey('{"a":1}') }];
    const client = createFakeClient(rows, serviceInstances);

    await expect(backfillDecryptionKeys(client)).rejects.toThrow('service instance svc-1');
    expect(client.credential.update).not.toHaveBeenCalled();
    expect(rows[0].decryptionKey).toBe('b'.repeat(64));
  });

  it('aborts before writing when an existing credential envelope cannot be decrypted', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: await envelopeUnderOtherKey('c'.repeat(64)) },
    ];
    const client = createFakeClient(rows);

    await expect(backfillDecryptionKeys(client)).rejects.toThrow('DATA_ENCRYPTION_KEY');
    expect(client.credential.update).not.toHaveBeenCalled();
    expect(rows[0].decryptionKey).toBe('b'.repeat(64));
  });

  it('aborts on a mixed-key database even when the first envelope decrypts', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: protectDecryptionKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: 'plain'.padEnd(64, 'p') },
      { id: 'cred-3', decryptionKey: await envelopeUnderOtherKey('c'.repeat(64)) },
    ];
    const client = createFakeClient(rows);

    await expect(backfillDecryptionKeys(client)).rejects.toThrow('credential cred-3');
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('names every failing row in the preflight abort, not only the first', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: await envelopeUnderOtherKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: await envelopeUnderOtherKey('c'.repeat(64)) },
    ];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: await envelopeUnderOtherKey('{"a":1}') }];
    const client = createFakeClient(rows, serviceInstances);

    const error: Error = await backfillDecryptionKeys(client).then(
      () => {
        throw new Error('expected the preflight to abort');
      },
      (thrown: Error) => thrown,
    );
    expect(error.message).toContain('service instance svc-1, credential cred-1, credential cred-2');
    expect(error.message).toContain('First failure (service instance svc-1):');
    expect((error.cause as { message?: unknown })?.message).toEqual(expect.any(String));
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('aborts on a decrypt failure even under --force', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnderOtherKey('b'.repeat(64)) }];
    const client = createFakeClient(rows, []);

    await expect(backfillDecryptionKeys(client, { force: true })).rejects.toThrow('credential cred-1');
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('names corruption and decrypt failures together in one abort, even under --force', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [{ id: 'cred-1', decryptionKey: await envelopeUnderOtherKey('b'.repeat(64)) }];
    const serviceInstances: ServiceInstanceRow[] = [
      { id: 'svc-corrupt', config: 'not an envelope' },
      { id: 'svc-wrong', config: await envelopeUnderOtherKey('{"a":1}') },
    ];
    const client = createFakeClient(rows, serviceInstances);

    const error: Error = await backfillDecryptionKeys(client, { force: true }).then(
      () => {
        throw new Error('expected the preflight to abort');
      },
      (thrown: Error) => thrown,
    );
    expect(error.message).toContain(
      'Preflight found service instance(s) svc-corrupt whose configuration is not a valid encrypted envelope',
    );
    expect(error.message).toContain('Preflight decrypt failed for service instance svc-wrong, credential cred-1');
    expect(error.message).toContain('aborting before any write');
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('skips and reports rows resembling corrupted envelopes instead of wrapping them', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey, isProtectedDecryptionKey } = await import('./decryption-key-protection');

    const suspect = '{"cipherText":"q1w2';
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: protectDecryptionKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: suspect },
      { id: 'cred-3', decryptionKey: 'c'.repeat(64) },
    ];
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client);

    expect(result.suspectRowIds).toEqual(['cred-2']);
    expect(result.wrapped).toBe(1);
    expect(rows[1].decryptionKey).toBe(suspect);
    expect(isProtectedDecryptionKey(rows[2].decryptionKey as string)).toBe(true);
  });

  it('skips a credential row with every required key but null fields or an unsupported algorithm, as a suspect row', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    // Has cipherText/iv/tag/type — a presence-only envelope check would
    // wrongly count this as already-protected and skip it silently. It
    // must instead be flagged as a suspect row for the operator to
    // investigate, same as any other corrupted envelope-shaped value.
    const nullFields = '{"cipherText":null,"iv":null,"tag":null,"type":null}';
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: protectDecryptionKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: nullFields },
    ];
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client);

    expect(result.suspectRowIds).toEqual(['cred-2']);
    expect(rows[1].decryptionKey).toBe(nullFields);
  });

  it('flags a credential row whose tag is valid Base64 but the wrong decoded length, as a suspect row', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const tampered = JSON.parse(protectDecryptionKey('c'.repeat(64)) as string);
    tampered.tag = Buffer.from('too-short').toString('base64');
    const wrongLengthTag = JSON.stringify(tampered);
    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: protectDecryptionKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: wrongLengthTag },
    ];
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client);

    expect(result.suspectRowIds).toEqual(['cred-2']);
    expect(rows[1].decryptionKey).toBe(wrongLengthTag);
  });

  it('continues past rows deleted between fetch and update, counting them', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey, isProtectedDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: protectDecryptionKey('b'.repeat(64)) },
      { id: 'cred-2', decryptionKey: 'c'.repeat(64) },
      { id: 'cred-3', decryptionKey: 'e'.repeat(64) },
    ];
    const client = createFakeClient(rows);
    const passThrough = client.credential.update.getMockImplementation()!;
    client.credential.update.mockImplementation(async (args) => {
      if (args.where.id === 'cred-2') {
        // Simulate a concurrent delete landing after the fetch, before the update.
        rows.splice(
          rows.findIndex((row) => row.id === 'cred-2'),
          1,
        );
      }
      return passThrough(args);
    });

    const result = await backfillDecryptionKeys(client);

    expect(result.deletedRowIds).toEqual(['cred-2']);
    expect(result.wrapped).toBe(1);
    expect(isProtectedDecryptionKey(rows.find((row) => row.id === 'cred-3')!.decryptionKey as string)).toBe(true);
  });

  it('converges on a second run with no further writes and a verified key', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: 'c'.repeat(64) },
    ];
    const client = createFakeClient(rows);

    await backfillDecryptionKeys(client, { force: true });
    const second = await backfillDecryptionKeys(client);

    expect(second).toEqual({
      wrapped: 0,
      alreadyProtected: 2,
      keyVerified: true,
      suspectRowIds: [],
      deletedRowIds: [],
      preflightNotes: [],
    });
    expect(client.credential.update).toHaveBeenCalledTimes(2);
  });

  it('names the failing credential when a row update fails for another reason', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = [
      { id: 'cred-0', decryptionKey: protectDecryptionKey('a'.repeat(64)) },
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
    ];
    const client = createFakeClient(rows);
    client.credential.update.mockRejectedValueOnce(new Error('connection reset'));

    await expect(backfillDecryptionKeys(client)).rejects.toThrow('cred-1');
  });

  it('processes more rows than a single batch', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { isProtectedDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = Array.from({ length: 150 }, (_, index) => ({
      id: `cred-${String(index).padStart(3, '0')}`,
      decryptionKey: 'b'.repeat(64),
    }));
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client, { force: true });

    expect(result.wrapped).toBe(150);
    expect(result.keyVerified).toBe(false);
    expect(rows.every((row) => isProtectedDecryptionKey(row.decryptionKey as string))).toBe(true);
  });
});

describe('discardable stores in the preflight', () => {
  it('notes a damaged or unopenable replay body and wraps anyway, since the wrap never touches that store', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');
    const rows: Row[] = [{ id: 'cred-plain', decryptionKey: 'b'.repeat(64) }];
    const serviceInstances: ServiceInstanceRow[] = [{ id: 'svc-1', config: protectDecryptionKey('{"ok":true}') }];
    const replayRows: ReplayRow[] = [
      { id: 'claim-bad', responseBody: '["plain"]' },
      { id: 'claim-other', responseBody: await envelopeUnderOtherKey('[]') },
    ];
    const client = createFakeClient(rows, serviceInstances, replayRows);
    const onPreflightNote = jest.fn();

    const result = await backfillDecryptionKeys(client, { onPreflightNote });

    expect(result.wrapped).toBe(1);
    expect(result.preflightNotes).toEqual([
      expect.stringContaining(
        'idempotency claim(s) claim-bad, claim-other hold a replay body that is damaged or does not open',
      ),
    ]);
    expect(result.preflightNotes[0]).toContain('clear the replay body of the affected claims');
    expect(onPreflightNote).toHaveBeenCalledWith(result.preflightNotes[0]);
  });

  it('refuses to treat a replay body that opens as proof of the key', async () => {
    const { backfillDecryptionKeys, KeyUnverifiedError } = await import('./backfill-decryption-keys');
    const { protectDecryptionKey } = await import('./decryption-key-protection');
    const rows: Row[] = [{ id: 'cred-plain', decryptionKey: 'b'.repeat(64) }];
    const replayRows: ReplayRow[] = [{ id: 'claim-1', responseBody: protectDecryptionKey('[]') }];
    const client = createFakeClient(rows, [], replayRows);

    await expect(backfillDecryptionKeys(client)).rejects.toBeInstanceOf(KeyUnverifiedError);
    expect(rows[0].decryptionKey).toBe('b'.repeat(64));
  });
});
