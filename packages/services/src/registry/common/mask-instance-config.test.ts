import { maskInstanceConfig } from './mask-instance-config.js';
import type { IEncryptionService } from '../../encryption/encryption.interface.js';

// Mock getSensitiveFields so we control which fields are treated as sensitive
jest.mock('./get-sensitive-fields.js', () => ({
  getSensitiveFields: jest.fn(),
}));
import { getSensitiveFields } from './get-sensitive-fields.js';
const mockGetSensitiveFields = getSensitiveFields as jest.MockedFunction<typeof getSensitiveFields>;

describe('maskInstanceConfig', () => {
  const mockEncryptionService: IEncryptionService = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };

  const mockLogger = {
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('happy path', () => {
    it('decrypts config and masks fields listed in sensitiveFields with "***"', () => {
      const decryptedConfig = {
        apiKey: 'sk-123',
        baseUrl: 'http://example.com',
        secret: 'abc',
      };
      mockGetSensitiveFields.mockReturnValue(['apiKey', 'secret']);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify(decryptedConfig));

      const instance = {
        id: 'inst-1',
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({
        apiKey: '***',
        baseUrl: 'http://example.com',
        secret: '***',
      });
    });

    it('preserves non-sensitive fields unchanged', () => {
      const decryptedConfig = {
        apiKey: 'sk-123',
        baseUrl: 'http://example.com',
        bucket: 'my-bucket',
      };
      mockGetSensitiveFields.mockReturnValue(['apiKey']);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify(decryptedConfig));

      const instance = {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({
        apiKey: '***',
        baseUrl: 'http://example.com',
        bucket: 'my-bucket',
      });
    });

    it('does not add fields that are listed as sensitive but not present in config', () => {
      const decryptedConfig = {
        baseUrl: 'http://example.com',
      };
      mockGetSensitiveFields.mockReturnValue(['apiKey', 'secret']);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify(decryptedConfig));

      const instance = {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({ baseUrl: 'http://example.com' });
      expect(result.config).not.toHaveProperty('apiKey');
      expect(result.config).not.toHaveProperty('secret');
    });

    it('returns fully decrypted config unmasked when sensitiveFields is empty', () => {
      const decryptedConfig = {
        baseUrl: 'http://example.com',
        bucket: 'my-bucket',
      };
      mockGetSensitiveFields.mockReturnValue([]);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify(decryptedConfig));

      const instance = {
        serviceType: 'VC',
        adapterType: 'SOME_ADAPTER',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({
        baseUrl: 'http://example.com',
        bucket: 'my-bucket',
      });
    });
  });

  describe('instance spread', () => {
    it('preserves all other properties of the instance in the return value', () => {
      const decryptedConfig = { baseUrl: 'http://example.com' };
      mockGetSensitiveFields.mockReturnValue([]);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify(decryptedConfig));

      const instance = {
        id: 'inst-42',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
        name: 'My Service',
        serviceType: 'DID',
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.id).toBe('inst-42');
      expect(result.name).toBe('My Service');
      expect(result.serviceType).toBe('DID');
      expect(result.adapterType).toBe('VCKIT');
    });
  });

  describe('error paths', () => {
    it('returns error indicator when decrypt throws', () => {
      (mockEncryptionService.decrypt as jest.Mock).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const instance = {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({ error: 'Unable to decrypt configuration' });
    });

    it('returns error indicator when inner JSON.parse fails (malformed decrypted JSON)', () => {
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue('not valid json {{{');

      const instance = {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({ error: 'Unable to decrypt configuration' });
    });

    it('returns error indicator when outer JSON.parse fails (malformed encrypted envelope)', () => {
      const instance = {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: 'this is not valid json at all',
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.config).toEqual({ error: 'Unable to decrypt configuration' });
    });

    it('preserves other instance properties even when an error occurs', () => {
      (mockEncryptionService.decrypt as jest.Mock).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const instance = {
        id: 'inst-99',
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify({ encrypted: 'data' }),
        name: 'Failing Service',
      };

      const result = maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(result.id).toBe('inst-99');
      expect(result.name).toBe('Failing Service');
      expect(result.adapterType).toBe('VCKIT');
      expect(result.config).toEqual({ error: 'Unable to decrypt configuration' });
    });
  });

  describe('encryption service interaction', () => {
    it('passes the parsed config envelope to decrypt', () => {
      const envelope = { cipherText: 'abc', iv: '123', tag: 'xyz', type: 'aes-256-gcm' };
      mockGetSensitiveFields.mockReturnValue([]);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify({ baseUrl: 'http://example.com' }));

      const instance = {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        config: JSON.stringify(envelope),
      };

      maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(envelope);
    });

    it('calls getSensitiveFields with the instance serviceType and adapterType', () => {
      mockGetSensitiveFields.mockReturnValue([]);
      (mockEncryptionService.decrypt as jest.Mock).mockReturnValue(JSON.stringify({ baseUrl: 'http://example.com' }));

      const instance = {
        serviceType: 'IDR',
        adapterType: 'PYX_IDR',
        config: JSON.stringify({ encrypted: 'data' }),
      };

      maskInstanceConfig(instance, mockEncryptionService, mockLogger);

      expect(mockGetSensitiveFields).toHaveBeenCalledWith('IDR', 'PYX_IDR');
    });
  });
});
