import { detectCredentialType, detectVersion } from '@/lib/credentialService';
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
}));

describe('schemaValidation', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    (global.fetch as jest.Mock).mockClear();
    (detectCredentialType as jest.Mock).mockClear();
    (detectVersion as jest.Mock).mockClear();
    schemaCache.clear(); // Clear the cache so that fetch will be called
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

    it('should construct the legacy schema URL for a v0.6.0 DPP credential', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
      });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.6.0');

      await validateCredentialSchema({ type: 'DigitalProductPassport' });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.0.json',
        )}`,
      );
    });

    it('should construct the v0.7.0 schema URL for a DPP credential', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
      });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.7.0');

      await validateCredentialSchema({ type: 'DigitalProductPassport' });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
        )}`,
      );
    });

    it('should use the renamed ConformityCredential schema filename for a v0.7.0 DCC credential', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
      });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalConformityCredential');
      (detectVersion as jest.Mock).mockReturnValue('0.7.0');

      await validateCredentialSchema({ type: 'DigitalConformityCredential' });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json',
        )}`,
      );
    });

    describe('with real detectCredentialType and detectVersion (integration)', () => {
      const realCredentialService =
        jest.requireActual<typeof import('@/lib/credentialService')>('@/lib/credentialService');

      beforeEach(() => {
        (detectCredentialType as jest.Mock).mockImplementation(realCredentialService.detectCredentialType);
        (detectVersion as jest.Mock).mockImplementation(realCredentialService.detectVersion);
      });

      it('constructs the legacy schema URL from a real v0.6.0 DPP credential', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
        });

        const credential = {
          type: ['DigitalProductPassport', 'VerifiableCredential'],
          '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
        };

        await validateCredentialSchema(credential);

        expect(global.fetch).toHaveBeenCalledWith(
          `/api/schema?url=${encodeURIComponent(
            'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.0.json',
          )}`,
        );
      });

      it('constructs the v0.7.0 schema URL from a real v0.7.0 DPP credential', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
        });

        const credential = {
          type: ['DigitalProductPassport', 'VerifiableCredential'],
          '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        };

        await validateCredentialSchema(credential);

        expect(global.fetch).toHaveBeenCalledWith(
          `/api/schema?url=${encodeURIComponent(
            'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
          )}`,
        );
      });

      it('constructs the renamed v0.7.0 DCC schema URL from a real v0.7.0 DCC credential', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
        });

        const credential = {
          type: ['DigitalConformityCredential', 'VerifiableCredential'],
          '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        };

        await validateCredentialSchema(credential);

        expect(global.fetch).toHaveBeenCalledWith(
          `/api/schema?url=${encodeURIComponent(
            'https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json',
          )}`,
        );
      });
    });

    it('should construct v0.7.0 schema URLs for the remaining core credential types', async () => {
      const cases: Array<{ type: string; short: string; file: string }> = [
        { type: 'DigitalTraceabilityEvent', short: 'dte', file: 'DigitalTraceabilityEvent' },
        { type: 'DigitalFacilityRecord', short: 'dfr', file: 'DigitalFacilityRecord' },
        { type: 'DigitalIdentityAnchor', short: 'dia', file: 'DigitalIdentityAnchor' },
      ];

      for (const { type, short, file } of cases) {
        (global.fetch as jest.Mock).mockClear();
        schemaCache.clear();
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
        });

        (detectCredentialType as jest.Mock).mockReturnValue(type);
        (detectVersion as jest.Mock).mockReturnValue('0.7.0');

        await validateCredentialSchema({ type });

        expect(global.fetch).toHaveBeenCalledWith(
          `/api/schema?url=${encodeURIComponent(
            `https://untp.unece.org/artefacts/schema/v0.7.0/${short}/${file}.json`,
          )}`,
        );
      }
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

      (global.fetch as jest.Mock).mockResolvedValueOnce({
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
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.V2)).rejects.toThrow(
        'Failed to fetch schema: 404 Not Found',
      );
    });

    it('should handle network errors during schema fetch', async () => {
      const mockToast = { error: jest.fn() };
      jest.mock('sonner', () => ({ toast: mockToast }));

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
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

  describe('schema fetch deduplication', () => {
    it('issues a single fetch when several validations request the same schema concurrently', async () => {
      const mockSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        properties: {
          '@context': { type: 'array' },
          type: { type: 'string' },
        },
      };

      // Resolve fetch only after both callers are awaiting, to guarantee the second one
      // hits an in-flight promise rather than a populated cache.
      let resolveFetch: (value: any) => void = () => undefined;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      (global.fetch as jest.Mock).mockReturnValueOnce(fetchPromise);

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.5.0');

      const credential = {
        type: 'DigitalProductPassport',
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
        version: '0.5.0',
      };

      const first = validateCredentialSchema(credential);
      const second = validateCredentialSchema(credential);

      // Allow the in-flight promise lookup to wire up before resolving the fetch.
      await Promise.resolve();
      resolveFetch({ ok: true, json: () => Promise.resolve(mockSchema) });

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult.valid).toBe(true);
      expect(secondResult.valid).toBe(true);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
    });

    it('does not poison the cache when the first fetch fails', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              properties: { '@context': { type: 'array' } },
            }),
        });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (detectVersion as jest.Mock).mockReturnValue('0.5.0');

      const credential = {
        type: 'DigitalProductPassport',
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
        version: '0.5.0',
      };

      await expect(validateCredentialSchema(credential)).rejects.toThrow('Failed to fetch schema');

      // Second attempt should re-fetch (the failed promise was evicted), not throw the cached error.
      const result = await validateCredentialSchema(credential);
      expect(result.valid).toBe(true);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
    });

    it('does not mutate the cached schema when a relaxed validation runs', async () => {
      // The DPP 0.5.0 path (used when validating a DLP 0.4.0 extension) applies a
      // relaxFunction that strips `properties.type.const` etc. Prior to the cache-clone
      // fix, that mutation poisoned the cached schema for any later non-relaxed call
      // against the same URL.
      const strictSchema = {
        $id: 'https://example.com/dpp-0.5.0.json',
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        properties: {
          type: { type: 'array', const: ['DigitalProductPassport', 'VerifiableCredential'] },
          '@context': { type: 'array' },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(strictSchema),
      });

      const dlpCredential = {
        type: ['DigitalLivestockPassport', 'VerifiableCredential'],
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.0-9c0ad2b1ca6a9e497dedcfd8b87f35f1.json',
        ],
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');
      (detectVersion as jest.Mock).mockImplementation((_credential: any, domain?: string) =>
        domain === 'aatp.foodagility.com' ? '0.4.0' : '0.5.0',
      );

      // First call drives the relax path (DPP 0.5.0 via the DLP 0.4.0 extension).
      await validateCredentialSchema(dlpCredential);

      // The cached schema must be untouched: const + items.enum still present.
      const cached = schemaCache.get('https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json');
      expect(cached).toBeDefined();
      expect(cached.properties.type.const).toEqual(['DigitalProductPassport', 'VerifiableCredential']);
      expect(cached.$id).toBe('https://example.com/dpp-0.5.0.json');
    });
  });
});
