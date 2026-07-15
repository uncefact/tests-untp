export {};

const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: mockWarn, error: mockError }) },
}));

const originalEnv = process.env;

const VALID_ENCRYPTION_KEY = 'a'.repeat(64);
const PLAINTEXT_KEY = 'b'.repeat(64);

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env = { ...originalEnv, DATA_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('protectDecryptionKey', () => {
  it('returns undefined when no key is provided', async () => {
    const { protectDecryptionKey } = await import('./decryption-key-protection');
    expect(protectDecryptionKey(undefined)).toBeUndefined();
  });

  it('returns an encrypted envelope string that does not expose the plaintext key', async () => {
    const { protectDecryptionKey } = await import('./decryption-key-protection');

    const stored = protectDecryptionKey(PLAINTEXT_KEY);

    expect(stored).toBeDefined();
    expect(stored).not.toBe(PLAINTEXT_KEY);
    expect(stored).not.toContain(PLAINTEXT_KEY);

    const envelope = JSON.parse(stored as string);
    expect(envelope).toEqual(
      expect.objectContaining({
        cipherText: expect.any(String),
        iv: expect.any(String),
        tag: expect.any(String),
        type: expect.any(String),
      }),
    );
  });
});

describe('isProtectedDecryptionKey', () => {
  it('returns true for a protected key', async () => {
    const { protectDecryptionKey, isProtectedDecryptionKey } = await import('./decryption-key-protection');
    expect(isProtectedDecryptionKey(protectDecryptionKey(PLAINTEXT_KEY))).toBe(true);
  });

  it('returns false for a legacy plaintext key', async () => {
    const { isProtectedDecryptionKey } = await import('./decryption-key-protection');
    expect(isProtectedDecryptionKey(PLAINTEXT_KEY)).toBe(false);
  });

  it('returns false for values that parse as JSON but are not envelopes', async () => {
    const { isProtectedDecryptionKey } = await import('./decryption-key-protection');
    expect(isProtectedDecryptionKey('1'.repeat(64))).toBe(false);
    expect(isProtectedDecryptionKey('{"foo":"bar"}')).toBe(false);
  });

  it('returns false for a value with the right keys but null fields or an unsupported algorithm', async () => {
    const { isProtectedDecryptionKey } = await import('./decryption-key-protection');
    // Has every required key (so a presence-only check would wrongly call
    // this "protected"), but none of the values are usable — corruption,
    // not a genuine envelope.
    expect(isProtectedDecryptionKey('{"cipherText":null,"iv":null,"tag":null,"type":null}')).toBe(false);
    expect(isProtectedDecryptionKey('{"cipherText":"a","iv":"b","tag":"c","type":"des-ede3-cbc"}')).toBe(false);
  });
});

describe('looksEnvelopeLikeButInvalid', () => {
  it('flags truncated or corrupted envelope-like values', async () => {
    const { looksEnvelopeLikeButInvalid } = await import('./decryption-key-protection');
    expect(looksEnvelopeLikeButInvalid('{"cipherText":"q1w2')).toBe(true);
    expect(looksEnvelopeLikeButInvalid('{"foo":"bar"}')).toBe(true);
  });

  it('flags a value with every required key but null fields or an unsupported algorithm', async () => {
    const { looksEnvelopeLikeButInvalid } = await import('./decryption-key-protection');
    expect(looksEnvelopeLikeButInvalid('{"cipherText":null,"iv":null,"tag":null,"type":null}')).toBe(true);
    expect(looksEnvelopeLikeButInvalid('{"cipherText":"a","iv":"b","tag":"c","type":"des-ede3-cbc"}')).toBe(true);
  });

  it('accepts genuine envelopes and plausible legacy plaintext', async () => {
    const { looksEnvelopeLikeButInvalid, protectDecryptionKey } = await import('./decryption-key-protection');
    expect(looksEnvelopeLikeButInvalid(protectDecryptionKey(PLAINTEXT_KEY))).toBe(false);
    expect(looksEnvelopeLikeButInvalid(PLAINTEXT_KEY)).toBe(false);
    expect(looksEnvelopeLikeButInvalid('1'.repeat(64))).toBe(false);
  });
});

describe('revealDecryptionKey', () => {
  it('returns null when no key is stored', async () => {
    const { revealDecryptionKey } = await import('./decryption-key-protection');
    expect(revealDecryptionKey(null)).toBeNull();
  });

  it('round-trips a protected key back to the plaintext', async () => {
    const { protectDecryptionKey, revealDecryptionKey } = await import('./decryption-key-protection');

    const stored = protectDecryptionKey(PLAINTEXT_KEY);

    expect(revealDecryptionKey(stored as string)).toBe(PLAINTEXT_KEY);
  });

  it('returns a legacy plaintext key unchanged without warning', async () => {
    const { revealDecryptionKey } = await import('./decryption-key-protection');

    expect(revealDecryptionKey(PLAINTEXT_KEY)).toBe(PLAINTEXT_KEY);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('warns when a stored value resembles an envelope but cannot be parsed', async () => {
    const { revealDecryptionKey } = await import('./decryption-key-protection');

    const truncatedEnvelope = '{"cipherText":"q1w2';

    expect(revealDecryptionKey(truncatedEnvelope)).toBe(truncatedEnvelope);
    expect(mockWarn).toHaveBeenCalled();
  });

  it('warns and returns unchanged for a value with every required key but null fields, rather than misreporting it as a key mismatch', async () => {
    const { revealDecryptionKey } = await import('./decryption-key-protection');

    // Every field present (so the old, presence-only predicate treated this
    // as a genuine envelope), but the values are null. Decrypting this
    // would throw "Unsupported algorithm: null" — a corruption problem,
    // not a DATA_ENCRYPTION_KEY mismatch, so it must not surface as one.
    const corrupted = '{"cipherText":null,"iv":null,"tag":null,"type":null}';

    expect(revealDecryptionKey(corrupted)).toBe(corrupted);
    expect(mockWarn).toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('returns a legacy all-digit key unchanged', async () => {
    const { revealDecryptionKey } = await import('./decryption-key-protection');

    const allDigitKey = '1'.repeat(64);

    expect(revealDecryptionKey(allDigitKey)).toBe(allDigitKey);
  });

  it('surfaces the missing-key error, not the mismatch message, when no key is configured', async () => {
    const { protectDecryptionKey } = await import('./decryption-key-protection');
    const stored = protectDecryptionKey(PLAINTEXT_KEY) as string;

    jest.resetModules();
    delete process.env.DATA_ENCRYPTION_KEY;
    const { revealDecryptionKey } = await import('./decryption-key-protection');

    expect(() => revealDecryptionKey(stored)).toThrow('Missing required DATA_ENCRYPTION_KEY');
  });

  it('throws a key-mismatch error and logs when the stored envelope cannot be decrypted', async () => {
    const { protectDecryptionKey, revealDecryptionKey } = await import('./decryption-key-protection');

    const stored = protectDecryptionKey(PLAINTEXT_KEY) as string;
    const tampered = JSON.parse(stored);
    tampered.cipherText = Buffer.from('tampered-cipher-text').toString('base64');

    expect(() => revealDecryptionKey(JSON.stringify(tampered))).toThrow('DATA_ENCRYPTION_KEY');
    expect(mockError).toHaveBeenCalled();
  });
});
