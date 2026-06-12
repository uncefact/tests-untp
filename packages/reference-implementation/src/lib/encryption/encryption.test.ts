export {};

const mockWarn = jest.fn();
const mockLogger: Record<string, unknown> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: mockWarn,
  error: jest.fn(),
};
mockLogger.child = jest.fn(() => mockLogger);
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  createLogger: () => mockLogger,
}));

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env.DATA_ENCRYPTION_KEY;
  delete process.env.SERVICE_ENCRYPTION_KEY;
});

afterAll(() => {
  process.env = originalEnv;
});

describe('getEncryptionService', () => {
  const VALID_KEY = 'a'.repeat(64);

  it('throws when no encryption key is configured', async () => {
    const { getEncryptionService } = await import('./encryption');
    expect(() => getEncryptionService()).toThrow('Missing required DATA_ENCRYPTION_KEY');
  });

  it('includes .env guidance in the error message', async () => {
    const { getEncryptionService } = await import('./encryption');
    expect(() => getEncryptionService()).toThrow('Set this in your .env file or environment.');
  });

  it('throws when key format is invalid', async () => {
    process.env.DATA_ENCRYPTION_KEY = 'not-hex-string';
    const { getEncryptionService } = await import('./encryption');
    expect(() => getEncryptionService()).toThrow('64-character hex string');
  });

  it('throws when key is too short', async () => {
    process.env.DATA_ENCRYPTION_KEY = 'abc123';
    const { getEncryptionService } = await import('./encryption');
    expect(() => getEncryptionService()).toThrow('64-character hex string');
  });

  it('throws when key is empty', async () => {
    process.env.DATA_ENCRYPTION_KEY = '';
    const { getEncryptionService } = await import('./encryption');
    expect(() => getEncryptionService()).toThrow('Missing required DATA_ENCRYPTION_KEY');
  });

  it('returns a working encryption service from DATA_ENCRYPTION_KEY', async () => {
    process.env.DATA_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import('./encryption');
    const service = getEncryptionService();

    expect(service).toBeDefined();
    expect(typeof service.encrypt).toBe('function');
    expect(typeof service.decrypt).toBe('function');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('falls back to the deprecated SERVICE_ENCRYPTION_KEY with a warning', async () => {
    process.env.SERVICE_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import('./encryption');
    const service = getEncryptionService();

    expect(service).toBeDefined();
    expect(mockWarn).toHaveBeenCalled();
  });

  it('prefers DATA_ENCRYPTION_KEY over the deprecated name', async () => {
    process.env.DATA_ENCRYPTION_KEY = VALID_KEY;
    process.env.SERVICE_ENCRYPTION_KEY = 'b'.repeat(64);
    const { getEncryptionService } = await import('./encryption');
    const { AesGcmEncryptionAdapter, EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');

    const envelope = getEncryptionService().encrypt('payload', EncryptionAlgorithm.AES_256_GCM);

    // Decrypting with an independent adapter built from DATA_ENCRYPTION_KEY
    // fails unless the service encrypted with that key, not the deprecated one.
    const independent = new AesGcmEncryptionAdapter(VALID_KEY, mockLogger as never);
    expect(independent.decrypt(envelope)).toBe('payload');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('caches the instance across calls', async () => {
    process.env.DATA_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import('./encryption');

    const first = getEncryptionService();
    const second = getEncryptionService();
    expect(second).toBe(first);
  });

  it('service can encrypt and decrypt content', async () => {
    process.env.DATA_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import('./encryption');
    const { EncryptionAlgorithm } = await import('@uncefact/untp-ri-services/encryption');

    const service = getEncryptionService();
    const plaintext = '{"apiUrl":"https://example.com"}';
    const envelope = service.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);
    const decrypted = service.decrypt(envelope);

    expect(decrypted).toBe(plaintext);
  });
});
