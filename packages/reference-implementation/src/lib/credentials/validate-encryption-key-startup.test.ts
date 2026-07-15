export {};

import fs from 'fs';
import path from 'path';

const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: mockWarn, error: mockError }) },
}));

const originalEnv = process.env;

const ACTIVE_KEY = 'a'.repeat(64);
const OTHER_KEY = 'd'.repeat(64);
const PLACEHOLDER_KEY = '0'.repeat(64);

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env = { ...originalEnv, DATA_ENCRYPTION_KEY: ACTIVE_KEY };
});

afterAll(() => {
  process.env = originalEnv;
});

type ServiceInstanceRow = { id: string; config: string };
type CredentialRow = { id: string; decryptionKey: string | null };
type CredentialFindManyArgs = {
  where: { decryptionKey: { startsWith: string }; id?: { gt: string } };
  select: { id: true; decryptionKey: true };
  orderBy: { id: 'asc' };
  take: number;
};

/**
 * Mirrors backfill-decryption-keys.test.ts's fake client: it actually
 * applies the `where`/cursor/`take` arguments the code sends (rather than
 * ignoring them and returning canned data), so a test can prove the
 * production code queries with the right filter — see "queries credential
 * candidates with the expected filter" below.
 */
function createFakeClient(serviceInstances: ServiceInstanceRow[] = [], credentials: CredentialRow[] = []) {
  return {
    serviceInstance: {
      findFirst: jest.fn(async () => serviceInstances[0] ?? null),
    },
    credential: {
      findMany: jest.fn(
        async (args: CredentialFindManyArgs): Promise<CredentialRow[]> =>
          credentials
            .filter((row) => row.decryptionKey?.startsWith(args.where.decryptionKey.startsWith) ?? false)
            .filter((row) => (args.where.id ? row.id > args.where.id.gt : true))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, args.take)
            .map((row) => ({ id: row.id, decryptionKey: row.decryptionKey })),
      ),
    },
  };
}

async function encryptUnder(key: string, plaintext: string): Promise<string> {
  const { AesGcmEncryptionAdapter, EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const adapter = new AesGcmEncryptionAdapter(key, logger as never);
  return JSON.stringify(adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM));
}

async function buildEncryptionService(key: string) {
  const { AesGcmEncryptionAdapter } = await import('@uncefact/untp-ri-services/encryption');
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return new AesGcmEncryptionAdapter(key, logger as never);
}

describe('validateEncryptionKeyAtStartup', () => {
  it('validates against a service instance configuration and returns its id', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const config = await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}');
    const client = createFakeClient([{ id: 'svc-1', config }]);

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(result).toEqual({ validated: true, source: 'service-instance', id: 'svc-1' });
  });

  it('throws a named EncryptionKeyValidationError naming the service instance when the key cannot decrypt it', async () => {
    const { validateEncryptionKeyAtStartup, EncryptionKeyValidationError } = await import(
      './validate-encryption-key-startup'
    );
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Config was encrypted under a key different from the one the app is
    // now running with — exactly the "wrong key deployed" scenario #762
    // exists to catch before a real request hits it.
    const config = await encryptUnder(OTHER_KEY, '{"apiUrl":"x"}');
    const client = createFakeClient([{ id: 'svc-1', config }]);

    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow(
      EncryptionKeyValidationError,
    );
    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow('svc-1');
    expect(mockError).toHaveBeenCalled();
  });

  it('throws a CorruptedEnvelopeError (not a key-mismatch error) for a service instance configuration that is not valid JSON', async () => {
    const { validateEncryptionKeyAtStartup, CorruptedEnvelopeError, EncryptionKeyValidationError } = await import(
      './validate-encryption-key-startup'
    );
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Truncated JSON: every service instance config is written encrypted
    // (no legacy plaintext form), so a value that doesn't even parse is
    // corruption, not evidence the key is wrong. Attributing this to
    // DATA_ENCRYPTION_KEY would send an operator chasing the wrong fix.
    const client = createFakeClient([{ id: 'svc-1', config: '{"cipherText":"truncated' }]);

    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow(CorruptedEnvelopeError);
    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow('svc-1');
    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.not.toThrow(
      EncryptionKeyValidationError,
    );
  });

  it('throws a CorruptedEnvelopeError for a service instance configuration that is valid JSON but not envelope-shaped', async () => {
    const { validateEncryptionKeyAtStartup, CorruptedEnvelopeError } = await import(
      './validate-encryption-key-startup'
    );
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const client = createFakeClient([{ id: 'svc-1', config: '{"foo":"bar"}' }]);

    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow(CorruptedEnvelopeError);
  });

  it('falls back to a protected credential decryption key when no service instance exists', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const decryptionKey = await encryptUnder(ACTIVE_KEY, 'b'.repeat(64));
    const client = createFakeClient([], [{ id: 'cred-1', decryptionKey }]);

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credential', id: 'cred-1' });
  });

  it('throws naming the credential when its envelope was encrypted under a different key', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const decryptionKey = await encryptUnder(OTHER_KEY, 'b'.repeat(64));
    const client = createFakeClient([], [{ id: 'cred-1', decryptionKey }]);

    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow('cred-1');
  });

  it('returns validated: false when nothing encrypted exists anywhere, so startup proceeds normally', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const client = createFakeClient([], []);

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('returns validated: false when only legacy plaintext credential keys exist, not treating them as an envelope', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const client = createFakeClient([], [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }]);

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('returns validated: false when the only credential row is corrupted envelope-shaped data, not misreporting it as a key mismatch', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Starts with "{" (so the DB-level startsWith filter returns it as a
    // candidate) but does not parse as a valid encrypted envelope —
    // corruption, not a key mismatch, and there is nothing else to
    // validate against.
    const client = createFakeClient([], [{ id: 'cred-1', decryptionKey: '{"cipherText":"truncated' }]);

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('scans past a corrupted candidate to a genuinely wrong-key row, instead of reporting nothing encrypted', async () => {
    const { validateEncryptionKeyAtStartup, EncryptionKeyValidationError } = await import(
      './validate-encryption-key-startup'
    );
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // "a-corrupt" sorts before "w-wrongkey" in id order, so it is the first
    // candidate the scan reaches. If a corrupted first candidate were
    // treated as proof nothing is encrypted, the wrong key on the second
    // row would never be caught and the app would boot unable to decrypt
    // its own data.
    const client = createFakeClient(
      [],
      [
        { id: 'a-corrupt', decryptionKey: '{"cipherText":"truncated' },
        { id: 'w-wrongkey', decryptionKey: await encryptUnder(OTHER_KEY, 'b'.repeat(64)) },
      ],
    );

    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow(
      EncryptionKeyValidationError,
    );
    await expect(validateEncryptionKeyAtStartup(client, encryptionService)).rejects.toThrow('w-wrongkey');
  });

  it('scans past a corrupted candidate to find a genuinely valid envelope under the active key', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const client = createFakeClient(
      [],
      [
        { id: 'a-corrupt', decryptionKey: '{"cipherText":"truncated' },
        { id: 'z-valid', decryptionKey: await encryptUnder(ACTIVE_KEY, 'b'.repeat(64)) },
      ],
    );

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credential', id: 'z-valid' });
  });

  it('queries credential candidates with the expected filter, selection, and ordering', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const client = createFakeClient([], []);

    await validateEncryptionKeyAtStartup(client, encryptionService);

    expect(client.credential.findMany).toHaveBeenCalledWith({
      where: { decryptionKey: { startsWith: '{' } },
      select: { id: true, decryptionKey: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
  });

  it('prefers the service instance over a credential when both exist', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const config = await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}');
    const decryptionKey = await encryptUnder(OTHER_KEY, 'b'.repeat(64));
    const client = createFakeClient([{ id: 'svc-1', config }], [{ id: 'cred-1', decryptionKey }]);

    const result = await validateEncryptionKeyAtStartup(client, encryptionService);

    // The credential envelope is under a different key, but it is never
    // consulted because a service instance was found first.
    expect(result).toEqual({ validated: true, source: 'service-instance', id: 'svc-1' });
    expect(client.credential.findMany).not.toHaveBeenCalled();
  });
});

describe('assertNotPlaceholderEncryptionKey', () => {
  it('does nothing for a real key regardless of environment', async () => {
    const { assertNotPlaceholderEncryptionKey } = await import('./validate-encryption-key-startup');
    expect(() => assertNotPlaceholderEncryptionKey(ACTIVE_KEY, { deploymentEnvironment: 'production' })).not.toThrow();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('warns and proceeds for the placeholder key in local development', async () => {
    const { assertNotPlaceholderEncryptionKey } = await import('./validate-encryption-key-startup');
    expect(() => assertNotPlaceholderEncryptionKey(PLACEHOLDER_KEY, { deploymentEnvironment: 'local' })).not.toThrow();
    expect(mockWarn).toHaveBeenCalled();
  });

  it('defaults to local (and warns rather than throws) when DEPLOYMENT_ENVIRONMENT is unset', async () => {
    const { assertNotPlaceholderEncryptionKey } = await import('./validate-encryption-key-startup');
    delete process.env.DEPLOYMENT_ENVIRONMENT;
    expect(() => assertNotPlaceholderEncryptionKey(PLACEHOLDER_KEY)).not.toThrow();
    expect(mockWarn).toHaveBeenCalled();
  });

  it('refuses the placeholder key outside local development', async () => {
    const { assertNotPlaceholderEncryptionKey, PlaceholderEncryptionKeyError } = await import(
      './validate-encryption-key-startup'
    );
    expect(() => assertNotPlaceholderEncryptionKey(PLACEHOLDER_KEY, { deploymentEnvironment: 'production' })).toThrow(
      PlaceholderEncryptionKeyError,
    );
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('treats an empty or whitespace-only DEPLOYMENT_ENVIRONMENT as absent (defaults to local)', async () => {
    const { assertNotPlaceholderEncryptionKey } = await import('./validate-encryption-key-startup');
    expect(() => assertNotPlaceholderEncryptionKey(PLACEHOLDER_KEY, { deploymentEnvironment: '   ' })).not.toThrow();
    expect(mockWarn).toHaveBeenCalled();
  });

  it('matches "local" case-insensitively', async () => {
    const { assertNotPlaceholderEncryptionKey } = await import('./validate-encryption-key-startup');
    expect(() => assertNotPlaceholderEncryptionKey(PLACEHOLDER_KEY, { deploymentEnvironment: 'Local' })).not.toThrow();
    expect(mockWarn).toHaveBeenCalled();
  });
});

describe('.env.example placeholder stays in sync with the detector', () => {
  it('matches the DATA_ENCRYPTION_KEY committed in .env.example', () => {
    const envExamplePath = path.resolve(__dirname, '../../../../../.env.example');
    const contents = fs.readFileSync(envExamplePath, 'utf-8');
    const match = contents.match(/^DATA_ENCRYPTION_KEY=(.*)$/m);

    expect(match).not.toBeNull();
    // If .env.example ever changes this value, the detector must change
    // with it, or it silently stops recognising the published placeholder.
    expect(match?.[1]).toBe('0'.repeat(64));
  });
});
