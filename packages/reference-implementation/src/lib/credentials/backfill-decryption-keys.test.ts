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

function createFakeClient(rows: Row[]) {
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
        if (!row) throw new Error(`row not found: ${args.where.id}`);
        row.decryptionKey = args.data.decryptionKey;
        return row;
      }),
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

    expect(result).toEqual({ wrapped: 1, alreadyProtected: 1, keyVerified: true });
    expect(isProtectedDecryptionKey(rows[0].decryptionKey as string)).toBe(true);
    expect(revealDecryptionKey(rows[0].decryptionKey)).toBe('b'.repeat(64));
    expect(revealDecryptionKey(rows[1].decryptionKey)).toBe('c'.repeat(64));
    expect(rows[2].decryptionKey).toBeNull();
  });

  it('reports the key as unverified when no existing envelope is available to check against', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: 'c'.repeat(64) },
    ];
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client);

    expect(result).toEqual({ wrapped: 2, alreadyProtected: 0, keyVerified: false });
  });

  it('converges on a second run with no further writes and a verified key', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [
      { id: 'cred-1', decryptionKey: 'b'.repeat(64) },
      { id: 'cred-2', decryptionKey: 'c'.repeat(64) },
    ];
    const client = createFakeClient(rows);

    await backfillDecryptionKeys(client);
    const second = await backfillDecryptionKeys(client);

    expect(second).toEqual({ wrapped: 0, alreadyProtected: 2, keyVerified: true });
    expect(client.credential.update).toHaveBeenCalledTimes(2);
  });

  it('aborts before writing anything when an existing envelope cannot be decrypted', async () => {
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

  it('names the failing credential when a row update fails', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const rows: Row[] = [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }];
    const client = createFakeClient(rows);
    client.credential.update.mockRejectedValueOnce(new Error('record not found'));

    await expect(backfillDecryptionKeys(client)).rejects.toThrow('cred-1');
  });

  it('returns zero counts when no credentials hold a key', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');

    const client = createFakeClient([{ id: 'cred-1', decryptionKey: null }]);

    const result = await backfillDecryptionKeys(client);

    expect(result).toEqual({ wrapped: 0, alreadyProtected: 0, keyVerified: false });
    expect(client.credential.update).not.toHaveBeenCalled();
  });

  it('processes more rows than a single batch', async () => {
    const { backfillDecryptionKeys } = await import('./backfill-decryption-keys');
    const { isProtectedDecryptionKey } = await import('./decryption-key-protection');

    const rows: Row[] = Array.from({ length: 150 }, (_, index) => ({
      id: `cred-${String(index).padStart(3, '0')}`,
      decryptionKey: 'b'.repeat(64),
    }));
    const client = createFakeClient(rows);

    const result = await backfillDecryptionKeys(client);

    expect(result).toEqual({ wrapped: 150, alreadyProtected: 0, keyVerified: false });
    expect(rows.every((row) => isProtectedDecryptionKey(row.decryptionKey as string))).toBe(true);
  });
});
