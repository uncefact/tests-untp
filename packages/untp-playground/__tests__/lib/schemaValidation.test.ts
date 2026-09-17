import { detectCredentialType } from '@/lib/credentialService';
import { decodeEnvelopedCredential } from '@/lib/credentialService';
import {
  detectExtension,
  schemaCache,
  SchemaFetchError,
  SchemaSelectionError,
  validateCredentialSchema,
  validateExtension,
  validateVcAgainstSchema,
  formatObserved,
} from '@/lib/schemaValidation';
import { VCDMVersion } from '../../constants';

// Mock the global fetch
global.fetch = jest.fn();

jest.mock('@/lib/credentialService', () => ({
  ...jest.requireActual('@/lib/credentialService'),
  detectCredentialType: jest.fn(),
}));

describe('schemaValidation', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    (global.fetch as jest.Mock).mockClear();
    (detectCredentialType as jest.Mock).mockClear();
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
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'],
        version: '0.5.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

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

      await validateCredentialSchema({
        type: 'DigitalProductPassport',
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.0.json',
        )}`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    it('should construct the v0.7.0 schema URL for a DPP credential', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
      });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      await validateCredentialSchema({
        type: 'DigitalProductPassport',
        '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
        )}`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    it('should use the renamed ConformityCredential schema filename for a v0.7.0 DCC credential', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} }),
      });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalConformityCredential');

      await validateCredentialSchema({
        type: 'DigitalConformityCredential',
        '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json',
        )}`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    describe('with real canonical version detection (integration)', () => {
      const realCredentialService =
        jest.requireActual<typeof import('@/lib/credentialService')>('@/lib/credentialService');

      beforeEach(() => {
        (detectCredentialType as jest.Mock).mockImplementation(realCredentialService.detectCredentialType);
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
          expect.objectContaining({ signal: expect.any(Object) }),
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
          expect.objectContaining({ signal: expect.any(Object) }),
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
          expect.objectContaining({ signal: expect.any(Object) }),
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

        await validateCredentialSchema({
          type,
          '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        });

        expect(global.fetch).toHaveBeenCalledWith(
          `/api/schema?url=${encodeURIComponent(
            `https://untp.unece.org/artefacts/schema/v0.7.0/${short}/${file}.json`,
          )}`,
          expect.objectContaining({ signal: expect.any(Object) }),
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

      const error = await validateCredentialSchema(invalidCredential).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SchemaSelectionError);
      expect(error).toMatchObject({
        reason: 'unknown-type',
        message:
          'The credential declares type values ["UnsupportedType"], but none is a UNTP type this Playground validates.',
      });
    });

    it('states the missing type fact without a contrastive clause', async () => {
      (detectCredentialType as jest.Mock).mockReturnValue('Unknown');

      await expect(validateCredentialSchema({ '@context': [] })).rejects.toMatchObject({
        reason: 'unknown-type',
        message: 'The credential declares no type values, so the Playground could not select a UNTP schema.',
      });
    });

    it('should throw error for missing version', async () => {
      const invalidCredential = {
        type: 'DigitalProductPassport',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      const error = await validateCredentialSchema(invalidCredential).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SchemaSelectionError);
      expect(error).toMatchObject({
        reason: 'version-not-detected',
        message: 'The credential declares no @context entries, so no UNTP version can be detected.',
      });
    });

    it('conveys the shared typed fetch failure from validateCredentialSchema', async () => {
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'Schema host returned status 503', upstreamStatus: 503 }),
      });

      await expect(
        validateCredentialSchema({
          type: 'DigitalProductPassport',
          '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/'],
        }),
      ).rejects.toMatchObject({
        name: 'SchemaFetchError',
        category: 'upstream-status',
        serviceStatus: 502,
        upstreamStatus: 503,
        reason: 'network',
      });
    });

    it('detects a terminal version path and lets the published schema enforce its context string', async () => {
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      const publishedDppV050Schema = require('../fixtures/untp-dpp-schema-0.5.0.json');
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(publishedDppV050Schema),
      });

      const credential = {
        type: ['DigitalProductPassport', 'VerifiableCredential'],
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
        id: 'https://example.com/credentials/dpp-0.5.0',
        issuer: { id: 'did:web:example.com', name: 'Example Company' },
      };

      const slashlessResult = await validateCredentialSchema(credential);

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json',
        )}`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
      expect(slashlessResult.valid).toBe(false);
      expect(slashlessResult.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keyword: 'const',
            instancePath: '/@context',
            params: {
              allowedValue: [
                'https://www.w3.org/ns/credentials/v2',
                'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/',
              ],
            },
          }),
        ]),
      );
      expect(slashlessResult.errors?.every((error) => error.instancePath.startsWith('/@context'))).toBe(true);

      const canonicalResult = await validateCredentialSchema({
        ...credential,
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'],
      });

      expect(canonicalResult.valid).toBe(true);
      expect(canonicalResult.errors?.some((error) => error.instancePath.startsWith('/@context'))).toBe(false);
    });

    // Expected schema URLs by row: the 0.6.0, 0.6.1 and 0.7.0 rows are the `url` fields recorded in
    // packages/untp-utils/artefacts/manifest.json, which is independent of the builder under test.
    // v0.5.0 is not bundled, so those five rows characterise the output of the constructor this
    // change deletes, recorded before its deletion. The 0.5.0 DPP row is corroborated by the
    // published schema fixture in __tests__/fixtures/untp-dpp-schema-0.5.0.json, fetched from that
    // same URL on 2026-09-15.
    const compatibilityCases = [
      {
        type: 'DigitalProductPassport',
        context: 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json',
      },
      {
        type: 'DigitalConformityCredential',
        context: 'https://test.uncefact.org/vocabulary/untp/dcc/0.5.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/untp-dcc-schema-0.5.0.json',
      },
      {
        type: 'DigitalTraceabilityEvent',
        context: 'https://test.uncefact.org/vocabulary/untp/dte/0.5.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dte/untp-dte-schema-0.5.0.json',
      },
      {
        type: 'DigitalFacilityRecord',
        context: 'https://test.uncefact.org/vocabulary/untp/dfr/0.5.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dfr/untp-dfr-schema-0.5.0.json',
      },
      {
        type: 'DigitalIdentityAnchor',
        context: 'https://test.uncefact.org/vocabulary/untp/dia/0.5.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dia/untp-dia-schema-0.5.0.json',
      },
      {
        type: 'DigitalProductPassport',
        context: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.0.json',
      },
      {
        type: 'DigitalConformityCredential',
        context: 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/untp-dcc-schema-0.6.0.json',
      },
      {
        type: 'DigitalTraceabilityEvent',
        context: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dte/untp-dte-schema-0.6.0.json',
      },
      {
        type: 'DigitalFacilityRecord',
        context: 'https://test.uncefact.org/vocabulary/untp/dfr/0.6.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dfr/untp-dfr-schema-0.6.0.json',
      },
      {
        type: 'DigitalIdentityAnchor',
        context: 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dia/untp-dia-schema-0.6.0.json',
      },
      {
        type: 'DigitalProductPassport',
        context: 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.1.json',
      },
      {
        type: 'DigitalConformityCredential',
        context: 'https://test.uncefact.org/vocabulary/untp/dcc/0.6.1/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dcc/untp-dcc-schema-0.6.1.json',
      },
      {
        type: 'DigitalTraceabilityEvent',
        context: 'https://test.uncefact.org/vocabulary/untp/dte/0.6.1/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dte/untp-dte-schema-0.6.1.json',
      },
      {
        type: 'DigitalFacilityRecord',
        context: 'https://test.uncefact.org/vocabulary/untp/dfr/0.6.1/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dfr/untp-dfr-schema-0.6.1.json',
      },
      {
        type: 'DigitalIdentityAnchor',
        context: 'https://test.uncefact.org/vocabulary/untp/dia/0.6.1/',
        schemaUrl: 'https://test.uncefact.org/vocabulary/untp/dia/untp-dia-schema-0.6.1.json',
      },
      {
        type: 'DigitalProductPassport',
        context: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
      },
      {
        type: 'DigitalConformityCredential',
        context: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json',
      },
      {
        type: 'DigitalTraceabilityEvent',
        context: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/dte/DigitalTraceabilityEvent.json',
      },
      {
        type: 'DigitalFacilityRecord',
        context: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/dfr/DigitalFacilityRecord.json',
      },
      {
        type: 'DigitalIdentityAnchor',
        context: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/dia/DigitalIdentityAnchor.json',
      },
      {
        type: 'ConformityScheme',
        context: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json',
      },
    ] as const;

    // AC3: the bespoke regex truncated '0.7.0-rc.1' to '0.7.0-rc'. The whole prerelease has to
    // reach the schema URL, not just the detector's return value.
    it('carries a multi-segment prerelease through to the schema URL', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ type: 'object' }),
      });
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      await validateCredentialSchema({
        type: 'DigitalProductPassport',
        '@context': ['https://vocabulary.uncefact.org/untp/0.7.0-rc.1/context/'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://untp.unece.org/artefacts/schema/v0.7.0-rc.1/dpp/DigitalProductPassport.json',
        )}`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    it.each(compatibilityCases)(
      'preserves the schema URL for $type at $context',
      async ({ type, context, schemaUrl }) => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ type: 'object' }),
        });
        (detectCredentialType as jest.Mock).mockReturnValue(type);

        await validateCredentialSchema({ type, '@context': [context] });

        expect(global.fetch).toHaveBeenCalledWith(
          `/api/schema?url=${encodeURIComponent(schemaUrl)}`,
          expect.objectContaining({ signal: expect.any(Object) }),
        );
      },
    );
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

      const error = await validateExtension(invalidCredential).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SchemaSelectionError);
      expect(error).toMatchObject({
        reason: 'unsupported-extension-version',
        message: 'The credential declares type values ["UnknownExtension"], but no registered extension matches them.',
      });
    });

    it('states the missing type fact when no extension type is declared', async () => {
      (detectCredentialType as jest.Mock).mockReturnValue('Unknown');

      await expect(validateExtension({})).rejects.toMatchObject({
        reason: 'unsupported-extension-version',
        message: 'The credential declares no type values, so the Playground could not select a registered extension.',
      });
    });

    it('states the missing extension context fact when a registered extension type is declared', async () => {
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      await expect(validateCredentialSchema({ type: 'DigitalLivestockPassport' })).rejects.toMatchObject({
        reason: 'unsupported-extension-version',
        message:
          'The credential declares no recognised extension context entries, so no registered extension version can be detected.',
      });
    });
  });

  it('caps long document-declared observations', () => {
    const observed = formatObserved(['x'.repeat(240), 'second value']);
    expect(observed.length).toBe(200);
    expect(observed.endsWith('...')).toBe(true);
  });

  describe('detectExtension', () => {
    it('should detect a valid extension', () => {
      const credential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
        version: '0.4.0',
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

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

      const result = detectExtension(credential);
      expect(result).toBeUndefined();
    });

    it('uses the first extension-domain context entry before considering later entries', () => {
      const credential = {
        type: 'DigitalLivestockPassport',
        '@context': [
          'https://aatp.foodagility.com/context/aatp-dlp-context-0.4.0.jsonld',
          'https://aatp.foodagility.com/0.4.1-beta1/context.jsonld',
        ],
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      expect(detectExtension(credential)).toEqual({
        core: { type: 'DigitalProductPassport', version: '0.5.0' },
        extension: { type: 'DigitalLivestockPassport', version: '0.4.0' },
      });
    });

    // Disclosed behaviour: the adapter's legacy fallback stops a prerelease at the first dot, so a
    // filename naming 0.4.1-beta1.2 is read as the registered 0.4.1-beta1. A canonical-only adapter
    // returns undefined here, and a fallback without the prerelease group reads 0.4.1.
    it('truncates a dotted prerelease in a filename-shaped extension context', () => {
      const credential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/context/aatp-dlp-context-0.4.1-beta1.2.jsonld'],
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      expect(detectExtension(credential)).toEqual({
        core: { type: 'DigitalProductPassport', version: '0.6.0-beta7' },
        extension: { type: 'DigitalLivestockPassport', version: '0.4.1-beta1' },
      });
    });

    // The canonical detector keeps the whole prerelease `0.4.1-beta1.2`, which is unregistered;
    // a fallback-only adapter would truncate it to registered `0.4.1-beta1` and select core `0.6.0-beta7`.
    it('returns undefined for an unregistered dotted prerelease in a slash-bounded extension context', () => {
      const credential = {
        type: 'DigitalLivestockPassport',
        '@context': ['https://aatp.foodagility.com/0.4.1-beta1.2/context/'],
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      expect(detectExtension(credential)).toBeUndefined();
    });

    it('keeps an unregistered extension type from reaching URL construction or fetch', async () => {
      const credential = {
        type: ['DigitalLivestockPassport'],
        '@context': [
          'https://www.w3.org/ns/credentials/v2',
          'https://aatp.foodagility.com/9.9.9/context/',
          'https://vocabulary.uncefact.org/untp/0.7.0/context/',
        ],
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      // The type is recognised and the version is not, so the failure names the version, not the
      // type. Falling through to the own-key check would report the supported type as unsupported.
      await expect(validateCredentialSchema(credential)).rejects.toThrow(
        'The credential declares extension context ["https://aatp.foodagility.com/9.9.9/context/"], but none matches the registered extension versions',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    // The own-key check still owns the other half: a type in neither map. The real detector yields
    // 'Unknown' for a credential naming none of the six core types, so this input is constructible
    // without stubbing the detector. Every other value it can return is in one map or the other.
    it('reports an unrecognised type from the real detector as an unsupported type, before any fetch', async () => {
      const realCredentialService =
        jest.requireActual<typeof import('@/lib/credentialService')>('@/lib/credentialService');
      (detectCredentialType as jest.Mock).mockImplementation(realCredentialService.detectCredentialType);

      await expect(
        validateCredentialSchema({
          type: ['VerifiableCredential'],
          '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        }),
      ).rejects.toThrow(
        'The credential declares type values ["VerifiableCredential"], but none is a UNTP type this Playground validates.',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('detects the DLP filename-embedded version from the real extension fixture', async () => {
      const fixture = require('../../e2e/cypress/fixtures/credentials-e2e/invalid-v2-enveloped-dpp-with-extension.json');
      const credential = decodeEnvelopedCredential(fixture);
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ type: 'object' }),
      });

      const result = await validateCredentialSchema(credential);

      expect(detectExtension(credential)).toEqual({
        core: { type: 'DigitalProductPassport', version: '0.5.0' },
        extension: { type: 'DigitalLivestockPassport', version: '0.4.0' },
      });
      expect(result.valid).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/schema?url=${encodeURIComponent(
          'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json',
        )}`,
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    it('detects a core context at any array position and fails it against the published v0.5.0 schema', async () => {
      const fixture = require('../../e2e/cypress/fixtures/credentials-e2e/invalid-schema-v2-enveloped-dpp.json');
      const credential = decodeEnvelopedCredential(fixture);
      // The published v0.5.0 DPP schema body, recorded verbatim on 2026-09-15 from
      // https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json. v0.5.0 is not in
      // the untp-utils bundled manifest, so the fixture is this suite's only copy of it.
      const publishedDppV050Schema = require('../fixtures/untp-dpp-schema-0.5.0.json');

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(publishedDppV050Schema),
      });

      const result = await validateCredentialSchema(credential);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ keyword: 'const', instancePath: '/@context' }),
          expect.objectContaining({ keyword: 'enum', instancePath: '/@context/0' }),
        ]),
      );
      // The e2e spec asserts this fixture fails UNTP Schema Validation. A failure made only of
      // additionalProperties errors is reported as valid, so the @context errors are what keep it red.
      expect(result.errors?.every((error: any) => error.keyword === 'additionalProperties')).toBe(false);
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
        json: async () => ({ error: 'Schema service rejected the request' }),
      });

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.V2)).rejects.toThrow(
        'Schema service rejected the request',
      );
    });

    it('surfaces the proxy route error body when the schema host fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ error: 'Schema host returned status 404', upstreamStatus: 404 }),
      });

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.V2)).rejects.toMatchObject({
        name: 'SchemaFetchError',
        serviceStatus: 502,
        upstreamStatus: 404,
        category: 'upstream-status',
        message: expect.stringContaining('Schema host returned status 404'),
      });
    });

    it('rejects a credential whose UNTP version could not be detected before fetching', async () => {
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      await expect(validateCredentialSchema({ type: 'DigitalProductPassport' })).rejects.toThrow(
        'The credential declares no @context entries, so no UNTP version can be detected.',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('treats a credential whose only failures are additionalProperties as valid', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {
              type: { type: 'string' },
              '@context': { type: 'array' },
            },
            additionalProperties: false,
          }),
      });
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      const result = await validateCredentialSchema({
        type: 'DigitalProductPassport',
        '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        extra: 'field',
      });
      expect(result.valid).toBe(true);
      expect(result.errors?.map((error) => error.keyword)).toEqual(['additionalProperties']);
    });

    it('relaxes the DPP 0.5.0 type and context constraints for a DLP credential', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {
              type: { type: 'array', items: { enum: ['DigitalProductPassport'] } },
              '@context': { type: 'array', items: { enum: ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'] } },
            },
          }),
      });
      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      const result = await validateCredentialSchema({
        type: ['DigitalLivestockPassport'],
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle network errors during schema fetch', async () => {
      const mockToast = { error: jest.fn() };
      jest.mock('sonner', () => ({ toast: mockToast }));

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const credential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
      };

      await expect(validateVcAgainstSchema(credential, VCDMVersion.V2)).rejects.toThrow(
        'The Playground schema service could not be reached',
      );
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
        'The credential declares VCDM context version "unknown", but this Playground has no schema mapped for it.',
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

      const credential = {
        type: 'DigitalProductPassport',
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'],
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
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: 'Too many requests' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              properties: { '@context': { type: 'array' } },
            }),
        });

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');

      const credential = {
        type: 'DigitalProductPassport',
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'],
        version: '0.5.0',
      };

      await expect(validateCredentialSchema(credential)).rejects.toThrow('Too many requests');

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
          'https://aatp.foodagility.com/context/aatp-dlp-context-0.4.0.jsonld',
        ],
      };

      (detectCredentialType as jest.Mock).mockReturnValue('DigitalLivestockPassport');

      // First call drives the relax path (DPP 0.5.0 via the DLP 0.4.0 extension).
      await validateCredentialSchema(dlpCredential);

      // The cached schema must be untouched: const + items.enum still present.
      // A cache hit never calls the loader, so a throwing loader proves the schema was cached.
      const cached = await schemaCache.get(
        'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json',
        () => Promise.reject(new Error('not cached')),
      );
      expect(cached).toBeDefined();
      expect(cached.properties.type.const).toEqual(['DigitalProductPassport', 'VerifiableCredential']);
      expect(cached.$id).toBe('https://example.com/dpp-0.5.0.json');
    });
  });
});
