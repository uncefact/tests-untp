import { detectVersionFromContext } from '@uncefact/untp-utils/artefacts';
import { SchemaSelectionError, validateSchemeSchema } from '@/lib/schemeValidation';

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

      await expect(validateSchemeSchema({}, '0.6.0')).rejects.toThrow(
        'Conformity Scheme schemas have no legacy layout before UNTP 0.7.0; detected 0.6.0.',
      );
      await expect(validateSchemeSchema({}, '0.6.0')).rejects.toBeInstanceOf(SchemaSelectionError);
      expect(global.fetch).not.toHaveBeenCalled();
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
          message: expect.stringContaining('No schema published at'),
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
