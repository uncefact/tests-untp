import { decryptCredential, computeHash, EncryptionAlgorithm, HashAlgorithm } from '../utils/cryptoService';
import crypto from 'crypto';

describe('cryptoService', () => {
  describe('decryptCredential', () => {
    const mockEncrypt = (data: string, key: Uint8Array, iv: Uint8Array): { cipherText: string; tag: string } => {
      const cipher = crypto.createCipheriv(EncryptionAlgorithm.AES_256_GCM, key, iv);
      let encrypted = cipher.update(data, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const tag = cipher.getAuthTag().toString('base64');
      return { cipherText: encrypted, tag };
    };

    it('should successfully decrypt a valid encrypted credential', () => {
      const plaintext = 'Secret credential data';
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const { cipherText, tag } = mockEncrypt(plaintext, new Uint8Array(key), new Uint8Array(iv));

      const decryptionParams = {
        cipherText,
        key: Buffer.from(key).toString('hex'),
        iv: Buffer.from(iv).toString('base64'),
        tag,
        type: EncryptionAlgorithm.AES_256_GCM,
      };

      const decrypted = decryptCredential(decryptionParams);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error for unsupported encryption type', () => {
      const invalidParams = {
        cipherText: 'dummy',
        key: 'a'.repeat(64),
        iv: 'b'.repeat(16),
        tag: 'c'.repeat(24),
        type: 'unsupported-type' as EncryptionAlgorithm,
      };

      expect(() => decryptCredential(invalidParams)).toThrow('Unsupported encryption type');
    });

    it('should throw an error for invalid key length', () => {
      const invalidParams = {
        cipherText: 'dummy',
        key: 'a'.repeat(62), // Invalid length
        iv: 'b'.repeat(16),
        tag: 'c'.repeat(24),
        type: EncryptionAlgorithm.AES_256_GCM,
      };

      expect(() => decryptCredential(invalidParams)).toThrow('Invalid key length');
    });

    it('should throw an error for invalid IV length', () => {
      const invalidParams = {
        cipherText: 'dummy',
        key: 'a'.repeat(64),
        iv: 'b'.repeat(10), // Invalid length
        tag: 'c'.repeat(24),
        type: EncryptionAlgorithm.AES_256_GCM,
      };

      expect(() => decryptCredential(invalidParams)).toThrow('Invalid IV length');
    });

    it('should throw an error for invalid tag length', () => {
      const invalidParams = {
        cipherText: 'dummy',
        key: 'a'.repeat(64),
        iv: 'b'.repeat(16),
        tag: 'c'.repeat(20), // Invalid length
        type: EncryptionAlgorithm.AES_256_GCM,
      };

      expect(() => decryptCredential(invalidParams)).toThrow('Invalid Auth Tag length');
    });
  });

  describe('computeHash', () => {
    it('should compute a SHA256 hash for a given credential', () => {
      const mockCredential = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
        issuanceDate: '2023-01-01T00:00:00Z',
        credentialSubject: {
          id: 'did:example:456',
          name: 'John Doe',
        },
      };

      const hash = computeHash(mockCredential);
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash is 64 characters long
    });

    it('should compute different hashes for different credentials', () => {
      const credential1 = { id: '1', name: 'Alice' };
      const credential2 = { id: '2', name: 'Bob' };

      const hash1 = computeHash(credential1);
      const hash2 = computeHash(credential2);

      expect(hash1).not.toBe(hash2);
    });

    it('should compute the same hash for the same credential', () => {
      const credential = { id: '1', name: 'Alice' };

      const hash1 = computeHash(credential);
      const hash2 = computeHash(credential);

      expect(hash1).toBe(hash2);
    });

    it('should use SHA256 as the default algorithm', () => {
      const credential = { id: '1', name: 'Alice' };
      const hash = computeHash(credential);
      const manualHash = crypto.createHash(HashAlgorithm.SHA256).update(JSON.stringify(credential)).digest('hex');

      expect(hash).toBe(manualHash);
    });
  });
});
