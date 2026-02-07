import { AesGcmEncryptionAdapter } from './aes-gcm.adapter';

describe('AesGcmEncryptionAdapter', () => {
  const TEST_KEY = 'test-encryption-key-for-unit-tests';

  // Constructor tests
  describe('constructor', () => {
    it('creates instance with a valid key', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      expect(adapter).toBeInstanceOf(AesGcmEncryptionAdapter);
    });

    it('throws if key is empty', () => {
      expect(() => new AesGcmEncryptionAdapter('')).toThrow('Encryption key must not be empty');
    });
  });

  // Encrypt/decrypt round-trip tests
  describe('encrypt and decrypt', () => {
    let adapter: AesGcmEncryptionAdapter;

    beforeEach(() => {
      adapter = new AesGcmEncryptionAdapter(TEST_KEY);
    });

    it('round-trips a simple string', () => {
      const plaintext = 'Hello, World!';
      const ciphertext = adapter.encrypt(plaintext);
      const decrypted = adapter.decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const plaintext = '';
      const ciphertext = adapter.encrypt(plaintext);
      const decrypted = adapter.decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips unicode content', () => {
      const plaintext = 'Colour: éèê — £100 🌍';
      const ciphertext = adapter.encrypt(plaintext);
      const decrypted = adapter.decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips a long string', () => {
      const plaintext = 'a'.repeat(10_000);
      const ciphertext = adapter.encrypt(plaintext);
      const decrypted = adapter.decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips JSON content', () => {
      const data = { endpoint: 'https://vckit.example.com', authToken: 'secret-123' };
      const plaintext = JSON.stringify(data);
      const ciphertext = adapter.encrypt(plaintext);
      const decrypted = adapter.decrypt(ciphertext);
      expect(JSON.parse(decrypted)).toEqual(data);
    });

    it('produces different ciphertext for the same plaintext (IV randomness)', () => {
      const plaintext = 'deterministic input';
      const ciphertext1 = adapter.encrypt(plaintext);
      const ciphertext2 = adapter.encrypt(plaintext);
      expect(ciphertext1).not.toBe(ciphertext2);
    });

    it('produces ciphertext in iv:authTag:encrypted hex format', () => {
      const ciphertext = adapter.encrypt('test');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3);
      // IV should be 12 bytes = 24 hex characters
      expect(parts[0]).toHaveLength(24);
      // Auth tag should be 16 bytes = 32 hex characters
      expect(parts[1]).toHaveLength(32);
      // All parts should be valid hex
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/);
      });
    });
  });

  // Decryption failure tests
  describe('decrypt errors', () => {
    let adapter: AesGcmEncryptionAdapter;

    beforeEach(() => {
      adapter = new AesGcmEncryptionAdapter(TEST_KEY);
    });

    it('throws on corrupt ciphertext (invalid format)', () => {
      expect(() => adapter.decrypt('not-valid-ciphertext')).toThrow('Invalid ciphertext format');
    });

    it('throws on corrupt ciphertext (tampered data)', () => {
      const ciphertext = adapter.encrypt('test');
      const parts = ciphertext.split(':');
      // Tamper with the encrypted portion
      parts[2] = 'ff'.repeat(parts[2].length / 2);
      expect(() => adapter.decrypt(parts.join(':'))).toThrow();
    });

    it('throws when decrypting with a different key', () => {
      const otherAdapter = new AesGcmEncryptionAdapter('completely-different-key');
      const ciphertext = adapter.encrypt('secret message');
      expect(() => otherAdapter.decrypt(ciphertext)).toThrow();
    });
  });
});
