import { detectVersionFromContext } from '@uncefact/untp-utils/artefacts';
import { SchemaSelectionError, validateSchemeSchema } from '@/lib/schemeValidation';
import { schemaCache } from '@/lib/schemaFetch';

describe('schemeValidation', () => {
  describe('canonical version detection', () => {
    it('extracts the version from a vocabulary.uncefact.org context URI', () => {
      expect(
        detectVersionFromContext({
          '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
          type: ['ConformityScheme'],
        }),
      ).toBe('0.7.0');
    });

    it('extracts the version from a test.uncefact.org context URI', () => {
      expect(
        detectVersionFromContext({
          '@context': ['https://test.uncefact.org/vocabulary/untp/cs/0.6.0/'],
          type: ['ConformityScheme'],
        }),
      ).toBe('0.6.0');
    });

    it('returns undefined when no UNTP context entry is present', () => {
      expect(
        detectVersionFromContext({
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          type: ['ConformityScheme'],
        }),
      ).toBeUndefined();
    });

    it('extracts the version from a string @context URL', () => {
      expect(detectVersionFromContext({ '@context': 'https://vocabulary.uncefact.org/untp/0.7.0/context/' })).toBe(
        '0.7.0',
      );
    });

    it('returns undefined for a non-UNTP string @context URL', () => {
      expect(detectVersionFromContext({ '@context': 'https://example.org/context/' })).toBeUndefined();
    });

    it('ignores non-string context entries', () => {
      expect(
        detectVersionFromContext({
          '@context': [{ inline: 'definition' }, 'https://vocabulary.uncefact.org/untp/0.7.1/context/'],
          type: ['ConformityScheme'],
        }),
      ).toBe('0.7.1');
    });

    it('preserves a multi-segment prerelease version', () => {
      expect(
        detectVersionFromContext({ '@context': ['https://vocabulary.uncefact.org/untp/0.7.0-rc.1/context/'] }),
      ).toBe('0.7.0-rc.1');
    });
  });

  describe('validateSchemeSchema', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });
    beforeEach(async () => {
      await schemaCache.clear();
    });

    it('builds the published cvc schema URL for a v0.7.0 scheme', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ type: 'object' }),
      }) as unknown as typeof fetch;

      const result = await validateSchemeSchema({}, '0.7.0');

      expect(result.schemaUrl).toBe('https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json');
      expect(global.fetch).toHaveBeenCalledWith(`/api/schema?url=${encodeURIComponent(result.schemaUrl)}`, {
        signal: expect.anything(),
      });
    });

    it('fails before fetching when the scheme version has no legacy schema layout', async () => {
      global.fetch = jest.fn() as unknown as typeof fetch;

      const error = await validateSchemeSchema({}, '0.6.0').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SchemaSelectionError);
      expect(error).toMatchObject({
        reason: 'scheme-version-unsupported',
        message:
          'The scheme declares UNTP version "0.6.0", but this Playground has schema layouts only for UNTP 0.7.0 and later.',
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('classifies an invalid schema under the carried dialect as unusable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 17 }),
      }) as unknown as typeof fetch;

      await expect(validateSchemeSchema({}, '9.9.20')).resolves.toMatchObject({
        valid: false,
        failure: {
          class: 'unusable-artefact',
          code: 'schema.validation.meta-schema',
          artefactUrl: 'https://untp.unece.org/artefacts/schema/v9.9.20/cvc/ConformityScheme.json',
        },
      });
    });

    it('reports an uncarried scheme dialect as unknown', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ $schema: 'http://json-schema.org/draft-07/schema', type: 'object' }),
      }) as unknown as typeof fetch;

      await expect(validateSchemeSchema({}, '9.9.21')).resolves.toMatchObject({
        valid: false,
        failure: { class: 'unknown', code: 'schema.validation.dialect' },
      });
    });

    it('reports a real Ajv compile throw as unknown', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { value: { $ref: '#/$defs/missing' } },
          $defs: {},
        }),
      }) as unknown as typeof fetch;

      await expect(validateSchemeSchema({}, '9.9.22')).resolves.toMatchObject({
        valid: false,
        failure: { class: 'unknown', code: 'schema.validation.compile' },
      });
    });

    it('does not downgrade an unexpected scheme field to success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        }),
      }) as unknown as typeof fetch;

      await expect(validateSchemeSchema({ name: 'scheme', unexpected: true }, '9.9.23')).resolves.toMatchObject({
        valid: false,
        failure: { class: 'credential-invalid', code: 'schema.validation.payload' },
      });
    });

    describe('fetch failures', () => {
      it.each([404, 403])('reports a missing schema when the proxy names an upstream %s', async (status) => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ error: `Schema host returned status ${status}`, upstreamStatus: status }),
        }) as unknown as typeof fetch;

        await expect(validateSchemeSchema({}, `9.9.${status}`)).rejects.toMatchObject({
          name: 'SchemaFetchError',
          reason: 'not-found',
          message: expect.stringContaining(`Schema host returned status ${status}`),
        });
      });

      it('maps the proxy invalid-json category to the parse reason', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Schema host returned a body that is not valid JSON', code: 'invalid-json' }),
        }) as unknown as typeof fetch;

        await expect(validateSchemeSchema({}, '9.9.7')).rejects.toMatchObject({ reason: 'parse' });
      });

      it('carries the proxy error category for any other upstream failure', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Schema host could not be reached' }),
        }) as unknown as typeof fetch;

        await expect(validateSchemeSchema({}, '9.9.8')).rejects.toMatchObject({
          reason: 'network',
          message: expect.stringContaining('Schema host could not be reached'),
        });
      });
    });
  });
});
