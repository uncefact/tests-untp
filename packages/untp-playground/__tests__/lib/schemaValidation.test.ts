import { validateCredentialSchema, validateExtension, detectExtension } from '@/lib/schemaValidation';
import { detectCredentialType, detectVersion } from '@/lib/credentialService';

// Mock the global fetch
global.fetch = jest.fn();

jest.mock('@/lib/credentialService', () => ({
  detectCredentialType: jest.fn(),
  detectVersion: jest.fn(),
}));

describe('schemaValidation', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    (global.fetch as jest.Mock).mockClear();
    (detectCredentialType as jest.Mock).mockClear();
    (detectVersion as jest.Mock).mockClear();
  });

  describe('validateCredentialSchema', () => {
    it('should validate a valid DPP credential', async () => {
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        properties: {
          type: { type: 'string' },
          '@context': { type: 'array' },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSchema),
      });

      const validCredential = {
        type: 'DigitalProductPassport',
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
        version: '0.5.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.5.0');

      const result = await validateCredentialSchema(validCredential);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate a valid DLP credential', async () => {
      const validCredential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
        version: '0.4.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.4.0');

      const result = await validateCredentialSchema(validCredential);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should throw error for unsupported credential type', async () => {
      const invalidCredential = {
        type: 'UnsupportedType',
        version: '0.5.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('Unknown');

      await expect(validateCredentialSchema(invalidCredential)).rejects.toThrow('Unsupported credential type');
    });

    it('should throw error for missing version', async () => {
      const invalidCredential = {
        type: 'DigitalProductPassport',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (detectVersion as jest.Mock).mockReturnValue(undefined);

      await expect(validateCredentialSchema(invalidCredential)).rejects.toThrow('Unsupported version');
    });
  });

  describe('validateExtension', () => {
    it('should validate a specific extension credential', async () => {
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        properties: {
          type: { type: 'string' },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSchema),
      });

      const validExtensionCredential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
        version: '0.4.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.4.0');

      const result = await validateExtension(validExtensionCredential);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should throw error for unknown extension', async () => {
      const invalidCredential = {
        type: 'UnknownExtension',
        version: '0.1.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('UnknownExtension');
      (detectVersion as jest.Mock).mockReturnValue('0.1.0');

      await expect(validateExtension(invalidCredential)).rejects.toThrow('Unknown extension');
    });
  });

  describe('detectExtension', () => {
    it('should detect a valid extension', () => {
      const credential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
        version: '0.4.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.4.0');

      const result = detectExtension(credential);
      expect(result).toEqual({
        core: { type: 'DigitalProductPassport', version: '0.5.0' },
        extension: { type: 'DigitalLivestockPassport', version: '0.4.0' },
      });
    });

    it('should return undefined for non-extension credential', () => {
      const credential = {
        type: 'DigitalProductPassport',
        version: '0.5.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      const result = detectExtension(credential);
      expect(result).toBeUndefined();
    });

    it('should return undefined for unknown version', () => {
      const credential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/999.999.999'],
        version: '999.999.999',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');
      (detectVersion as jest.Mock).mockReturnValue('999.999.999');

      const result = detectExtension(credential);
      expect(result).toBeUndefined();
    });
  });
});
