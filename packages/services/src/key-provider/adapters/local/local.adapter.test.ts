import { LocalKeyGenerator } from './local.adapter';
import type { LoggerService } from '../../../logging/types';

const mockLogger: LoggerService = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

describe('LocalKeyGenerator', () => {
  let generator: LocalKeyGenerator;

  beforeEach(() => {
    generator = new LocalKeyGenerator(mockLogger);
  });

  describe('generateKey', () => {
    it('returns an object with keyId, plaintextKey and encryptedKey', async () => {
      const result = await generator.generateKey();

      expect(result).toHaveProperty('keyId');
      expect(result).toHaveProperty('plaintextKey');
      expect(result).toHaveProperty('encryptedKey');
    });

    it('returns a valid UUID as keyId', async () => {
      const result = await generator.generateKey();
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

      expect(result.keyId).toMatch(uuidPattern);
    });

    it('returns 64-character hex strings for both keys', async () => {
      const result = await generator.generateKey();
      const hexPattern = /^[0-9a-f]{64}$/;

      expect(result.plaintextKey).toMatch(hexPattern);
      expect(result.encryptedKey).toMatch(hexPattern);
    });

    it('returns identical plaintextKey and encryptedKey (no wrapping in local generator)', async () => {
      const result = await generator.generateKey();

      expect(result.plaintextKey).toBe(result.encryptedKey);
    });

    it('produces different keys on consecutive calls', async () => {
      const result1 = await generator.generateKey();
      const result2 = await generator.generateKey();

      expect(result1.plaintextKey).not.toBe(result2.plaintextKey);
      expect(result1.encryptedKey).not.toBe(result2.encryptedKey);
    });
  });
});
