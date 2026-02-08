import crypto from 'crypto';
import { decryptCredential } from './decrypt-credential.js';
import { AesGcmEncryptionAdapter } from './adapters/aes-gcm/aes-gcm.adapter.js';
import { EncryptionAlgorithm } from './encryption.interface.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('decryptCredential', () => {
  describe('success cases', () => {
    it('decrypts a valid envelope', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const plaintext = '{"apiUrl":"https://example.com"}';
      const envelope = adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);

      const result = decryptCredential({
        cipherText: envelope.cipherText,
        key: TEST_KEY,
        iv: envelope.iv,
        tag: envelope.tag,
        type: envelope.type,
      });

      expect(result).toBe(plaintext);
    });

    it('decrypts unicode content', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const plaintext = 'Colour: éèê — £100 🌍';
      const envelope = adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);

      const result = decryptCredential({
        cipherText: envelope.cipherText,
        key: TEST_KEY,
        iv: envelope.iv,
        tag: envelope.tag,
        type: envelope.type,
      });

      expect(result).toBe(plaintext);
    });

    it('decrypts an empty string', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const plaintext = '';
      const envelope = adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);

      const result = decryptCredential({
        cipherText: envelope.cipherText,
        key: TEST_KEY,
        iv: envelope.iv,
        tag: envelope.tag,
        type: envelope.type,
      });

      expect(result).toBe(plaintext);
    });

    it('decrypts a long string', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const plaintext = 'a'.repeat(10_000);
      const envelope = adapter.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);

      const result = decryptCredential({
        cipherText: envelope.cipherText,
        key: TEST_KEY,
        iv: envelope.iv,
        tag: envelope.tag,
        type: envelope.type,
      });

      expect(result).toBe(plaintext);
    });
  });

  describe('error cases', () => {
    it('throws for unsupported algorithm', () => {
      expect(() =>
        decryptCredential({
          cipherText: 'abc',
          key: TEST_KEY,
          iv: 'abc',
          tag: 'abc',
          type: 'aes-128-cbc' as any,
        }),
      ).toThrow('Unsupported algorithm: aes-128-cbc');
    });

    it('throws for invalid key', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const envelope = adapter.encrypt('secret', EncryptionAlgorithm.AES_256_GCM);
      const wrongKey = crypto.randomBytes(32).toString('hex');

      expect(() =>
        decryptCredential({
          cipherText: envelope.cipherText,
          key: wrongKey,
          iv: envelope.iv,
          tag: envelope.tag,
          type: envelope.type,
        }),
      ).toThrow();
    });

    it('throws for tampered ciphertext', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const envelope = adapter.encrypt('data', EncryptionAlgorithm.AES_256_GCM);

      expect(() =>
        decryptCredential({
          cipherText: Buffer.from('tampered').toString('base64'),
          key: TEST_KEY,
          iv: envelope.iv,
          tag: envelope.tag,
          type: envelope.type,
        }),
      ).toThrow();
    });

    it('throws for tampered authentication tag', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const envelope = adapter.encrypt('data', EncryptionAlgorithm.AES_256_GCM);
      const tamperedTag = Buffer.alloc(16, 0xff).toString('base64');

      expect(() =>
        decryptCredential({
          cipherText: envelope.cipherText,
          key: TEST_KEY,
          iv: envelope.iv,
          tag: tamperedTag,
          type: envelope.type,
        }),
      ).toThrow();
    });

    it('throws for tampered IV', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY);
      const envelope = adapter.encrypt('data', EncryptionAlgorithm.AES_256_GCM);
      const tamperedIv = Buffer.alloc(12, 0xff).toString('base64');

      expect(() =>
        decryptCredential({
          cipherText: envelope.cipherText,
          key: TEST_KEY,
          iv: tamperedIv,
          tag: envelope.tag,
          type: envelope.type,
        }),
      ).toThrow();
    });
  });
});
