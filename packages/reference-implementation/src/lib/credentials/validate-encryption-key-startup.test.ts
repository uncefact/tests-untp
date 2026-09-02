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
import { fakeStores } from './envelope-stores.fake';

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
  it('never samples replay bodies: a database holding only those has nothing to validate against', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);
    const stores = fakeStores(
      [],
      [],
      [
        { id: 'claim-0', responseBody: await encryptUnder(OTHER_KEY, '[]') },
        { id: 'claim-1', responseBody: await encryptUnder(ACTIVE_KEY, '[]') },
      ],
    );

    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).resolves.toEqual({ validated: false });
    expect(stores.idempotencyResponses.candidates).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('validates against a service instance configuration and returns its id', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const config = await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}');
    const stores = fakeStores([{ id: 'svc-1', config }]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'svc-1' });
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
    const stores = fakeStores([{ id: 'svc-1', config }]);

    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow(
      EncryptionKeyValidationError,
    );
    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow('svc-1');
    expect(mockError).toHaveBeenCalled();
  });

  it('skips a corrupted service instance candidate and validates against a later genuinely valid one', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // "a-corrupt" sorts before "z-valid" in id order, so it is the first
    // candidate the scan reaches. A damaged config on one row must not stop
    // startup from finding and validating against another, genuinely valid
    // one — a multi-tenant deployment can have many service instances.
    const stores = fakeStores([
      { id: 'a-corrupt', config: '{"cipherText":"truncated' },
      { id: 'z-valid', config: await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}') },
    ]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'z-valid' });
    expect(mockWarn).toHaveBeenCalled();
  });

  it('skips a corrupted service instance candidate and still catches a wrong key on a later valid one', async () => {
    const { validateEncryptionKeyAtStartup, EncryptionKeyValidationError } = await import(
      './validate-encryption-key-startup'
    );
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // The corrupted row must not be mistaken for "nothing to validate" and
    // let a genuinely wrong key on "w-wrongkey" survive startup.
    const stores = fakeStores([
      { id: 'a-corrupt', config: '{"cipherText":"truncated' },
      { id: 'w-wrongkey', config: await encryptUnder(OTHER_KEY, '{"apiUrl":"x"}') },
    ]);

    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow(
      EncryptionKeyValidationError,
    );
    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow('w-wrongkey');
  });

  it('warn-skips a service instance candidate with an unsupported algorithm, instead of throwing it as a key mismatch', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Has every required key (cipherText/iv/tag/type), so a presence-only
    // envelope check would call this genuine and attempt to decrypt it,
    // which throws "Unsupported algorithm: des-ede3-cbc" — a corruption
    // problem, not a DATA_ENCRYPTION_KEY mismatch. It must be classified as
    // shape-invalid up front and skipped like any other corrupted
    // candidate, falling through to a later valid one instead.
    const unsupportedAlgorithm = '{"cipherText":"a","iv":"b","tag":"c","type":"des-ede3-cbc"}';
    const stores = fakeStores([
      { id: 'a-unsupported-algo', config: unsupportedAlgorithm },
      { id: 'z-valid', config: await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}') },
    ]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    // Resolving to a valid result (rather than rejecting with
    // EncryptionKeyValidationError) is itself the proof that the
    // unsupported-algorithm candidate was skipped, not decrypted-and-failed.
    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'z-valid' });
    expect(mockWarn).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('warn-skips a service instance candidate whose cipherText/iv/tag decode to 0 bytes, instead of crash-looping', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Exact reported repro: single-character fields decode leniently to 0
    // bytes via Node's Buffer.from(str, 'base64') instead of throwing, so a
    // shape-and-type-only check waved this through. That reached decrypt(),
    // which threw "Invalid initialization vector" — a structural error
    // decryptOrThrow used to mislabel as EncryptionKeyValidationError and
    // crash-loop the whole process.
    const zeroByteFields = '{"cipherText":"a","iv":"b","tag":"c","type":"aes-256-gcm"}';
    const stores = fakeStores([
      { id: 'a-zero-byte-fields', config: zeroByteFields },
      { id: 'z-valid', config: await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}') },
    ]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'z-valid' });
    expect(mockWarn).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('degrades to validated: false, not a crash, when the only candidate has zero-byte fields', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const zeroByteFields = '{"cipherText":"a","iv":"b","tag":"c","type":"aes-256-gcm"}';
    const stores = fakeStores([{ id: 'a-zero-byte-fields', config: zeroByteFields }]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('warn-skips a service instance candidate whose IV is valid Base64 but the wrong decoded length', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Distinct from the 0-byte case: this IV is properly-formatted,
    // non-empty Base64 that decodes to 8 bytes instead of the 12
    // AES-256-GCM requires. Node does not reject this at construction, and
    // the eventual failure throws the identical error a genuinely wrong key
    // produces, so this can only be caught by checking the decoded length
    // before decrypting.
    const goodEnvelope = JSON.parse(await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}'));
    const wrongLengthIv = { ...goodEnvelope, iv: Buffer.from('12345678').toString('base64') };
    const stores = fakeStores([
      { id: 'a-wrong-iv-length', config: JSON.stringify(wrongLengthIv) },
      { id: 'z-valid', config: await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}') },
    ]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'z-valid' });
    expect(mockWarn).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('falls through to a credential when every service instance candidate is corrupted', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // No service instance is usable as a sample, but that must not crash
    // the process, and must not stop the check falling through to a
    // credential envelope that can still validate the key.
    const decryptionKey = await encryptUnder(ACTIVE_KEY, 'b'.repeat(64));
    const stores = fakeStores(
      [{ id: 'svc-corrupt', config: '{"cipherText":"truncated' }],
      [{ id: 'cred-1', decryptionKey }],
    );

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credentials', id: 'cred-1' });
    expect(mockWarn).toHaveBeenCalled();
  });

  it('finds a valid service instance candidate past a hundred corrupted ones', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // The first hundred candidates are damaged and only the last one is a
    // genuine envelope. A scan that gave up after some number of damaged rows
    // would wrongly conclude nothing encrypted exists.
    const serviceInstances: ServiceInstanceRow[] = Array.from({ length: 100 }, (_, index) => ({
      id: `svc-${String(index).padStart(3, '0')}`,
      config: '{"cipherText":"truncated',
    }));
    serviceInstances.push({ id: 'svc-100', config: await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}') });
    const stores = fakeStores(serviceInstances);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'svc-100' });
  });

  it('falls back to a protected credential decryption key when no service instance exists', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const decryptionKey = await encryptUnder(ACTIVE_KEY, 'b'.repeat(64));
    const stores = fakeStores([], [{ id: 'cred-1', decryptionKey }]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credentials', id: 'cred-1' });
  });

  it('throws naming the credential when its envelope was encrypted under a different key', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const decryptionKey = await encryptUnder(OTHER_KEY, 'b'.repeat(64));
    const stores = fakeStores([], [{ id: 'cred-1', decryptionKey }]);

    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow('cred-1');
  });

  it('returns validated: false when nothing encrypted exists anywhere, so startup proceeds normally', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const stores = fakeStores([], []);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('returns validated: false when only legacy plaintext credential keys exist, not treating them as an envelope', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const stores = fakeStores([], [{ id: 'cred-1', decryptionKey: 'b'.repeat(64) }]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('returns validated: false when the only credential row is corrupted envelope-shaped data, not misreporting it as a key mismatch', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Starts with "{" (so the DB-level startsWith filter returns it as a
    // candidate) but does not parse as a valid encrypted envelope —
    // corruption, not a key mismatch, and there is nothing else to
    // validate against.
    const stores = fakeStores([], [{ id: 'cred-1', decryptionKey: '{"cipherText":"truncated' }]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: false });
  });

  it('scans past a corrupted candidate to a genuinely wrong-key credential row, instead of reporting nothing encrypted', async () => {
    const { validateEncryptionKeyAtStartup, EncryptionKeyValidationError } = await import(
      './validate-encryption-key-startup'
    );
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // "a-corrupt" sorts before "w-wrongkey" in id order, so it is the first
    // candidate the scan reaches. If a corrupted first candidate were
    // treated as proof nothing is encrypted, the wrong key on the second
    // row would never be caught and the app would boot unable to decrypt
    // its own data.
    const stores = fakeStores(
      [],
      [
        { id: 'a-corrupt', decryptionKey: '{"cipherText":"truncated' },
        { id: 'w-wrongkey', decryptionKey: await encryptUnder(OTHER_KEY, 'b'.repeat(64)) },
      ],
    );

    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow(
      EncryptionKeyValidationError,
    );
    await expect(validateEncryptionKeyAtStartup(stores, encryptionService)).rejects.toThrow('w-wrongkey');
  });

  it('scans past a corrupted candidate to find a genuinely valid credential envelope under the active key', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const stores = fakeStores(
      [],
      [
        { id: 'a-corrupt', decryptionKey: '{"cipherText":"truncated' },
        { id: 'z-valid', decryptionKey: await encryptUnder(ACTIVE_KEY, 'b'.repeat(64)) },
      ],
    );

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credentials', id: 'z-valid' });
  });

  it('warn-skips a credential candidate whose IV is valid Base64 but the wrong decoded length', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Same class as the service instance case: valid, non-empty Base64
    // that decodes to the wrong byte count. Node does not reject this
    // until decrypt's final auth check, with the identical error a
    // genuinely wrong key produces, so this can only be caught
    // structurally, before decrypt.
    const goodEnvelope = JSON.parse(await encryptUnder(ACTIVE_KEY, 'b'.repeat(64)));
    const wrongLengthIv = { ...goodEnvelope, iv: Buffer.from('12345678').toString('base64') };
    const stores = fakeStores(
      [],
      [
        { id: 'a-wrong-iv-length', decryptionKey: JSON.stringify(wrongLengthIv) },
        { id: 'z-valid', decryptionKey: await encryptUnder(ACTIVE_KEY, 'b'.repeat(64)) },
      ],
    );

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credentials', id: 'z-valid' });
    expect(mockWarn).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('finds a valid credential candidate past a hundred corrupted ones', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    // Same shape as the service instance case: only the last candidate
    // genuinely validates.
    const credentials: CredentialRow[] = Array.from({ length: 100 }, (_, index) => ({
      id: `cred-${String(index).padStart(3, '0')}`,
      decryptionKey: '{"cipherText":"truncated',
    }));
    credentials.push({ id: 'cred-100', decryptionKey: await encryptUnder(ACTIVE_KEY, 'b'.repeat(64)) });
    const stores = fakeStores([], credentials);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    expect(result).toEqual({ validated: true, source: 'credentials', id: 'cred-100' });
  });

  it('prefers a valid service instance over a credential when both exist', async () => {
    const { validateEncryptionKeyAtStartup } = await import('./validate-encryption-key-startup');
    const encryptionService = await buildEncryptionService(ACTIVE_KEY);

    const config = await encryptUnder(ACTIVE_KEY, '{"apiUrl":"x"}');
    const decryptionKey = await encryptUnder(OTHER_KEY, 'b'.repeat(64));
    const stores = fakeStores([{ id: 'svc-1', config }], [{ id: 'cred-1', decryptionKey }]);

    const result = await validateEncryptionKeyAtStartup(stores, encryptionService);

    // The credential envelope is under a different key, but it is never
    // consulted because a valid service instance was found first.
    expect(result).toEqual({ validated: true, source: 'serviceInstances', id: 'svc-1' });
    expect(stores.credentials.candidates).not.toHaveBeenCalled();
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
