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

function createFakeClient(rows: Row[], serviceInstances: ServiceInstanceRow[] = []) {
  return {
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
    serviceInstance: {
      findMany: jest.fn(
        async (args: { where?: { id?: { gt: string } }; take: number }): Promise<ServiceInstanceRow[]> =>
          serviceInstances
            .filter((row) => (args.where?.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({ id: row.id, config: row.config })),
      ),
    },
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
      'Service instance svc-1 holds a configuration that is not a valid encrypted envelope',
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
