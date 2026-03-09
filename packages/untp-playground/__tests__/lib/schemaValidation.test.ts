import {
  detectCredentialType,
  detectVersion,
  constructExtensionRegistry,
  detectAllTypes,
} from '@/lib/credentialService';
import {
  detectExtension,
  schemaCache,
  validateCredentialSchema,
  validateExtension,
  validateVcAgainstSchema,
} from '@/lib/schemaValidation';
import { VCDMVersion } from '../../constants';

// Mock the global fetch
global.fetch = jest.fn();

jest.mock('@/lib/credentialService', () => ({
  detectCredentialType: jest.fn(),
  detectVersion: jest.fn(),
  detectAllTypes: jest.fn(),
  constructExtensionRegistry: jest.fn(),
}));

describe('schemaValidation', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    (global.fetch as jest.Mock).mockClear();
    (detectCredentialType as jest.Mock).mockClear();
    (detectVersion as jest.Mock).mockClear();
    schemaCache.clear(); // Clear the cache so that fetch will be called
    (detectAllTypes as jest.Mock).mockReturnValue(['DigitalProductPassport']);
    (constructExtensionRegistry as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCredentialSchema', () => {
    it('should validate a valid DPP credential', async () => {
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        properties: {
          type: { type: 'string' },
          '@context': { type: 'array' },
          version: { type: 'string' },
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
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        properties: {
          type: { type: 'string' },
          '@context': { type: 'array' },
          version: { type: 'string' },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSchema),
      });

      const validCredential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
        version: '0.4.0',
      };

      (detectAllTypes as jest.Mock).mockReturnValue(['DigitalProductPassport', 'DigitalLivestockPassport']);
      (constructExtensionRegistry as jest.Mock).mockReturnValue({
        DigitalLivestockPassport: {
          domain: 'example.com',
          versions: [
            {
              version: '0.4.0',
              schema: 'https://example.com/schema/dlp/0.4.0',
              core: { type: 'DigitalProductPassport', version: '0.5.0' },
            },
          ],
        },
      });
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

      global.fetch = jest.fn().mockResolvedValueOnce({
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
      (detectAllTypes as jest.Mock).mockReturnValue(['DigitalProductPassport', 'DigitalLivestockPassport']);
      (constructExtensionRegistry as jest.Mock).mockReturnValue({
        DigitalLivestockPassport: {
          domain: 'example.com',
          versions: [
            {
              version: '0.4.0',
              schema: 'https://example.com/schema/dlp/0.4.0',
              core: { type: 'DigitalProductPassport', version: '0.5.0' },
            },
          ],
        },
      });

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
      (detectAllTypes as jest.Mock).mockReturnValue(['DigitalProductPassport', 'DigitalLivestockPassport']);
      (constructExtensionRegistry as jest.Mock).mockReturnValue({
        DigitalLivestockPassport: {
          domain: 'example.com',
          versions: [
            {
              version: '0.4.0',
              schema: 'https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0',
              core: { type: 'DigitalProductPassport', version: '0.5.0' },
            },
          ],
        },
      });

      const result = detectExtension(credential);
      expect(result).toEqual({
        core: { type: 'DigitalProductPassport', version: '0.5.0' },
        extension: {
          type: 'DigitalLivestockPassport',
          version: '0.4.0',
          schema: 'https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0',
        },
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

  describe('validateVcAgainstSchema', () => {
    it('should validate a valid verifiable credential', async () => {
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['@context', 'type', 'issuer'],
        properties: {
          '@context': {
            type: 'array',
            items: { type: 'string' },
          },
          type: {
            type: 'array',
            items: { type: 'string' },
          },
          issuer: { type: 'string' },
        },
        additionalProperties: false,
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSchema),
      });

      const validCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://w3id.org/security/suites/jws-2020/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
      };

      const result = await validateVcAgainstSchema(validCredential, VCDMVersion.V2);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle schema validation failures', async () => {
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['@context', 'type', 'issuer'],
        properties: {
          '@context': {
            type: 'array',
            items: { type: 'string' },
          },
          type: {
            type: 'array',
            items: { type: 'string' },
          },
          issuer: { type: 'string' },
        },
        additionalProperties: false,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSchema),
      });

      const invalidCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        // missing required issuer field
        invalidField: 'should not be here',
      };

      const result = await validateVcAgainstSchema(invalidCredential, VCDMVersion.V2);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(
        result.errors?.some((error) => error.keyword === 'required' && error.params.missingProperty === 'issuer'),
      ).toBe(true);
      expect(
        result.errors?.some(
          (error) => error.keyword === 'additionalProperties' && error.params.additionalProperty === 'invalidField',
        ),
      ).toBe(true);
    });

    it('should handle schema fetch failures', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.V2)).rejects.toThrow(
        'Failed to fetch schema: Not Found',
      );
    });

    it('should handle network errors during schema fetch', async () => {
      const mockToast = { error: jest.fn() };
      jest.mock('sonner', () => ({ toast: mockToast }));

      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));
      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.V2)).rejects.toThrow('Network error');
    });

    it('should throw error when schema URL is not found for version', async () => {
      const VCDM_SCHEMA_URLS = {};
      jest.mock('../../constants', () => ({
        ...jest.requireActual('../../constants'),
        VCDM_SCHEMA_URLS,
      }));

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.UNKNOWN as any)).rejects.toThrow(
        'Schema URL for VCDM version: unknown not found.',
      );
    });
  });
});
