import jsonld from 'jsonld';
import { describeJsonLdError, validateContext, validateRequiredFields } from '@/lib/contextValidation';

jest.mock('jsonld', () => ({
  expand: jest.fn(),
  compact: jest.fn(),
}));

describe('contextValidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateRequiredFields', () => {
    it('returns valid when @context is present', () => {
      expect(validateRequiredFields({ '@context': 'https://www.w3.org/2018/credentials/v1' })).toEqual({
        valid: true,
      });
    });

    it('returns invalid when input is null', () => {
      expect(validateRequiredFields(null as unknown as Record<string, any>)).toEqual({
        valid: false,
        errorMessage: 'Invalid JSON-LD document: must be a JSON object.',
      });
    });

    it('returns invalid when input is a primitive', () => {
      expect(validateRequiredFields('string' as unknown as Record<string, any>)).toEqual({
        valid: false,
        errorMessage: 'Invalid JSON-LD document: must be a JSON object.',
      });
    });

    it('returns invalid when @context is missing', () => {
      expect(validateRequiredFields({ id: '1234' })).toEqual({
        valid: false,
        errorMessage: 'Missing required "@context" property in credential.',
      });
    });
  });

  describe('describeJsonLdError', () => {
    describe('InvalidUrl', () => {
      it('produces a friendly message for a failed remote context load', () => {
        const error = {
          name: 'jsonld.InvalidUrl',
          details: {
            code: 'loading remote context failed',
            url: 'https://no-such-host.invalid/ctx.jsonld',
            cause: { message: 'getaddrinfo ENOTFOUND' },
          },
        };
        expect(describeJsonLdError(error)).toEqual({
          keyword: 'jsonldUrl',
          message:
            'Couldn\'t load the @context at "https://no-such-host.invalid/ctx.jsonld". Common causes: the URL is unreachable, blocked by CORS, redirected too many times, or returning a non-JSON-LD response. Underlying cause: getaddrinfo ENOTFOUND.',
          instancePath: '@context',
          params: {
            code: 'loading remote context failed',
            url: 'https://no-such-host.invalid/ctx.jsonld',
            cause: 'getaddrinfo ENOTFOUND',
          },
        });
      });
    });

    describe('SyntaxError', () => {
      it('explains protected term redefinition with the term name', () => {
        const error = {
          name: 'jsonld.SyntaxError',
          message: 'Invalid JSON-LD syntax; tried to redefine a protected term.',
          details: {
            code: 'protected term redefinition',
            term: 'id',
          },
        };
        expect(describeJsonLdError(error)).toEqual({
          keyword: 'jsonldSyntax',
          message:
            'Your @context redefines "id", which is a protected JSON-LD term. Either rename the term, or use a different @context that doesn\'t redefine it.',
          instancePath: '@context',
          params: { code: 'protected term redefinition', term: 'id' },
        });
      });

      it('falls back to the library message when no specific case matches', () => {
        const error = {
          name: 'jsonld.SyntaxError',
          message: 'Invalid JSON-LD syntax; @context must be an object.',
          details: { code: 'invalid local context' },
        };
        expect(describeJsonLdError(error).message).toContain("@context value isn't a valid JSON-LD context");
      });
    });

    describe('ValidationError', () => {
      it('explains an unmapped property by name', () => {
        const error = {
          name: 'jsonld.ValidationError',
          details: {
            event: {
              code: 'invalid property',
              message: 'Dropping property that did not expand into an absolute IRI or keyword.',
              details: { property: 'mediaQuery', expandedProperty: 'mediaQuery' },
            },
          },
        };
        const result = describeJsonLdError(error);
        expect(result.keyword).toBe('jsonldValidation');
        expect(result.message).toBe(
          'Property "mediaQuery" appears in the credential but isn\'t defined by any @context. Either add a definition for it to a @context, or remove the property from the credential.',
        );
        expect(result.params).toEqual({
          code: 'invalid property',
          property: 'mediaQuery',
          id: undefined,
          type: undefined,
          term: undefined,
          language: undefined,
        });
      });

      it('explains a relative @id reference with the offending value', () => {
        const error = {
          name: 'jsonld.ValidationError',
          details: {
            event: {
              code: 'relative @id reference',
              message: 'Relative @id reference found.',
              details: { id: 'not-an-iri', expandedId: 'not-an-iri' },
            },
          },
        };
        expect(describeJsonLdError(error).message).toBe(
          'The id "not-an-iri" is a relative reference. Use an absolute IRI such as "https://...", "did:...", or "urn:...".',
        );
      });

      it('explains an invalid language tag', () => {
        const error = {
          name: 'jsonld.ValidationError',
          details: {
            event: {
              code: 'invalid @language value',
              message: 'Invalid @language value.',
              details: { language: 'not a tag' },
            },
          },
        };
        expect(describeJsonLdError(error).message).toBe(
          '"not a tag" isn\'t a valid BCP-47 language tag. Use a tag like "en", "en-AU", or "fr-CA".',
        );
      });

      it('falls back to the library event message when the code is unknown', () => {
        const error = {
          name: 'jsonld.ValidationError',
          details: {
            event: {
              code: 'some-future-code',
              message: 'A new safe-mode rule fired.',
              details: { foo: 'bar' },
            },
          },
        };
        expect(describeJsonLdError(error).message).toBe('A new safe-mode rule fired.');
      });

      it('falls back to the wrapper message when no event is attached', () => {
        const error = {
          name: 'jsonld.ValidationError',
          message: 'Safe mode validation error.',
        };
        expect(describeJsonLdError(error).message).toBe('Safe mode validation error.');
      });
    });

    describe('unknown errors', () => {
      it('passes through name, message, and details for unrecognised error names', () => {
        const error = { name: 'TypeError', message: 'something exploded', details: { foo: 'bar' } };
        expect(describeJsonLdError(error)).toEqual({
          keyword: 'unknown',
          message: 'TypeError: something exploded',
          instancePath: '',
          params: { name: 'TypeError', details: { foo: 'bar' } },
        });
      });

      it('handles null/undefined input', () => {
        expect(describeJsonLdError(undefined).keyword).toBe('unknown');
        expect(describeJsonLdError(null).keyword).toBe('unknown');
      });
    });
  });

  describe('validateContext', () => {
    it('returns valid when expansion succeeds', async () => {
      const credential = { '@context': ['https://schema.org'], name: 'Test' };
      const expanded = [{ 'https://schema.org/name': [{ '@value': 'Test' }] }];
      (jsonld.expand as jest.Mock).mockResolvedValueOnce(expanded);

      const result = await validateContext(credential);

      expect(result).toEqual({ valid: true, data: expanded });
    });

    it('returns the required-field error when @context is missing', async () => {
      const result = await validateContext({ id: '1234' });
      expect(result).toEqual({
        valid: false,
        error: {
          keyword: 'required',
          message: 'Missing required "@context" property in credential.',
          instancePath: '',
          params: { missingProperty: '@context' },
        },
      });
    });

    it('surfaces a clear message when expansion throws', async () => {
      (jsonld.expand as jest.Mock).mockImplementationOnce(() => {
        throw {
          name: 'jsonld.ValidationError',
          details: {
            event: {
              code: 'invalid property',
              message: 'Dropping property that did not expand into an absolute IRI or keyword.',
              details: { property: 'mediaQuery' },
            },
          },
        };
      });

      const result = await validateContext({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        mediaQuery: 'foo',
      });
      expect(result.valid).toBe(false);
      expect(result.error?.keyword).toBe('jsonldValidation');
      expect(result.error?.message).toContain('Property "mediaQuery"');
      expect(result.error?.message).toContain("isn't defined by any @context");
    });
  });
});
