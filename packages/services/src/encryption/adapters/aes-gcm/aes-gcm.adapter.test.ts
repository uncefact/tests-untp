import crypto from 'crypto';
import { AesGcmEncryptionAdapter } from './aes-gcm.adapter';
import { EncryptionAlgorithm } from '../../encryption.interface';
import type { LoggerService } from '../../../logging/types';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const ALG = EncryptionAlgorithm.AES_256_GCM;

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

describe('AesGcmEncryptionAdapter', () => {
  describe('constructor', () => {
    it('creates instance with a valid 64-character hex key', () => {
      const adapter = new AesGcmEncryptionAdapter(TEST_KEY, mockLogger);
      expect(adapter).toBeInstanceOf(AesGcmEncryptionAdapter);
    });

    it('throws if key is not a 64-character hex string', () => {
      expect(() => new AesGcmEncryptionAdapter('short-key', mockLogger)).toThrow(
        'Encryption key must be a 64-character hex string (32 bytes)',
      );
    });

    it('throws if key is empty', () => {
      expect(() => new AesGcmEncryptionAdapter('', mockLogger)).toThrow(
        'Encryption key must be a 64-character hex string (32 bytes)',
      );
    });
  });

  describe('encrypt and decrypt', () => {
    let adapter: AesGcmEncryptionAdapter;

    beforeEach(() => {
      adapter = new AesGcmEncryptionAdapter(TEST_KEY, mockLogger);
    });

    it('round-trips a simple string', () => {
      const plaintext = 'Hello, World!';
      const envelope = adapter.encrypt(plaintext, ALG);
      expect(adapter.decrypt(envelope)).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const plaintext = '';
      const envelope = adapter.encrypt(plaintext, ALG);
      expect(adapter.decrypt(envelope)).toBe(plaintext);
    });

    it('round-trips unicode content', () => {
      const plaintext = 'Colour: éèê — £100 🌍';
      const envelope = adapter.encrypt(plaintext, ALG);
      expect(adapter.decrypt(envelope)).toBe(plaintext);
    });

    it('round-trips a long string', () => {
      const plaintext = 'a'.repeat(10_000);
      const envelope = adapter.encrypt(plaintext, ALG);
      expect(adapter.decrypt(envelope)).toBe(plaintext);
    });

    it('round-trips JSON content', () => {
      const data = { endpoint: 'https://vckit.example.com', authToken: 'secret-123' };
      const plaintext = JSON.stringify(data);
      const envelope = adapter.encrypt(plaintext, ALG);
      expect(JSON.parse(adapter.decrypt(envelope))).toEqual(data);
    });

    it('produces different envelopes for the same plaintext (IV randomness)', () => {
      const plaintext = 'deterministic input';
      const envelope1 = adapter.encrypt(plaintext, ALG);
      const envelope2 = adapter.encrypt(plaintext, ALG);
      expect(envelope1.iv).not.toBe(envelope2.iv);
      expect(envelope1.cipherText).not.toBe(envelope2.cipherText);
    });

    it('returns an EncryptedEnvelope with base64-encoded fields', () => {
      const envelope = adapter.encrypt('test', ALG);
      const base64Pattern = /^[A-Za-z0-9+/]+=*$/;

      expect(envelope.cipherText).toMatch(base64Pattern);
      expect(envelope.iv).toMatch(base64Pattern);
      expect(envelope.tag).toMatch(base64Pattern);
      expect(envelope.type).toBe('aes-256-gcm');

      // IV: 12 bytes
      expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
      // Auth tag: 16 bytes
      expect(Buffer.from(envelope.tag, 'base64')).toHaveLength(16);
    });
  });

  describe('encrypt errors', () => {
    let adapter: AesGcmEncryptionAdapter;

    beforeEach(() => {
      adapter = new AesGcmEncryptionAdapter(TEST_KEY, mockLogger);
    });

    it('throws when given an unsupported algorithm', () => {
      expect(() => adapter.encrypt('test', 'aes-128-cbc' as any)).toThrow('Unsupported algorithm: aes-128-cbc');
    });
  });

  describe('decryptToBytes', () => {
    let adapter: AesGcmEncryptionAdapter;

    beforeEach(() => {
      adapter = new AesGcmEncryptionAdapter(TEST_KEY, mockLogger);
    });

    it('returns the exact bytes that were encrypted, including ones no UTF-8 decode survives', () => {
      // A lone 0x80 decodes to U+FFFD and re-encodes as three different
      // bytes, so a caller that digests the plaintext cannot go through the
      // string form. Fails if decryptToBytes is implemented as decrypt with
      // an encode on the end.
      const plaintext = new Uint8Array([...Buffer.from('binary '), 0x80, 0xff, ...Buffer.from(' tail')]);
      const iv = new Uint8Array(12).fill(7);
      const cipher = crypto.createCipheriv(ALG, new Uint8Array(Buffer.from(TEST_KEY, 'hex')), iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()] as unknown as Uint8Array[]);
      const envelope = {
        cipherText: encrypted.toString('base64'),
        iv: Buffer.from(iv).toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        type: ALG,
      };

      expect(Array.from(adapter.decryptToBytes(envelope))).toEqual(Array.from(plaintext));
      expect(Array.from(Buffer.from(adapter.decrypt(envelope), 'utf8'))).not.toEqual(Array.from(plaintext));
    });

    it('agrees with decrypt for text that does survive a UTF-8 round trip', () => {
      const envelope = adapter.encrypt('a plain message', ALG);

      expect(Buffer.from(adapter.decryptToBytes(envelope)).toString('utf8')).toBe(adapter.decrypt(envelope));
    });
  });

  describe('decrypt errors', () => {
    let adapter: AesGcmEncryptionAdapter;

    beforeEach(() => {
      adapter = new AesGcmEncryptionAdapter(TEST_KEY, mockLogger);
    });

    it('throws when envelope has an unsupported algorithm type', () => {
      const envelope = adapter.encrypt('test', ALG);
      const wrong = { ...envelope, type: 'aes-128-cbc' as any };
      expect(() => adapter.decrypt(wrong)).toThrow('Unsupported algorithm: aes-128-cbc');
    });

    it('throws on tampered ciphertext', () => {
      const envelope = adapter.encrypt('test', ALG);
      const tampered = {
        ...envelope,
        cipherText: Buffer.alloc(Buffer.from(envelope.cipherText, 'base64').length, 0xff).toString('base64'),
      };
      expect(() => adapter.decrypt(tampered)).toThrow();
    });

    it('throws when decrypting with a different key', () => {
      const otherKey = crypto.randomBytes(32).toString('hex');
      const otherAdapter = new AesGcmEncryptionAdapter(otherKey, mockLogger);
      const envelope = adapter.encrypt('secret message', ALG);
      expect(() => otherAdapter.decrypt(envelope)).toThrow();
    });
  });
});
