import { describeJsonLdError, validateContext, validateRequiredFields } from '@/lib/contextValidation';

const fetchMock = jest.fn();

describe('contextValidation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const answer = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce({ status, json: async () => body } as unknown as Response);

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
    describe('context-fetch', () => {
      it('produces a friendly message for a failed remote context load, naming the URL', () => {
        expect(
          describeJsonLdError({
            kind: 'context-fetch',
            detail: 'could not fetch a remote @context: HTTP 503 from https://no-such-host.invalid/ctx.jsonld',
            code: 'resolver.http-error',
            url: 'https://no-such-host.invalid/ctx.jsonld',
          }),
        ).toEqual({
          keyword: 'jsonldUrl',
          message:
            'Couldn\'t load the @context at "https://no-such-host.invalid/ctx.jsonld". Common causes: the URL is unreachable, resolves to a private address, redirected too many times, or returned a non-JSON-LD response. could not fetch a remote @context: HTTP 503 from https://no-such-host.invalid/ctx.jsonld.',
          instancePath: '@context',
          params: {
            code: 'resolver.http-error',
            url: 'https://no-such-host.invalid/ctx.jsonld',
            cause: 'could not fetch a remote @context: HTTP 503 from https://no-such-host.invalid/ctx.jsonld',
          },
        });
      });

      it('keeps the flat policy message when no URL is named', () => {
        const result = describeJsonLdError({
          kind: 'context-fetch',
          detail: "a remote @context URL was rejected by this service's URL policy or could not be resolved",
        });
        expect(result.keyword).toBe('jsonldUrl');
        expect(result.message).toBe(
          "Couldn't load a @context URL: a remote @context URL was rejected by this service's URL policy or could not be resolved.",
        );
      });
    });

    describe('context-invalid', () => {
      it('explains that the fetched document is not a usable context', () => {
        const result = describeJsonLdError({
          kind: 'context-invalid',
          detail: 'a remote @context document was fetched but could not be used as a context',
          code: 'invalid remote context',
          url: 'https://example.com/ctx',
        });
        expect(result.keyword).toBe('jsonldUrl');
        expect(result.message).toContain('"https://example.com/ctx" was fetched but isn\'t a usable JSON-LD context');
        expect(result.params).toMatchObject({ code: 'invalid remote context', url: 'https://example.com/ctx' });
      });
    });

    describe('document syntax errors', () => {
      it('explains protected term redefinition with the term name', () => {
        const result = describeJsonLdError({
          kind: 'document',
          source: 'syntax-error',
          detail: 'Invalid JSON-LD syntax; tried to redefine a protected term.',
          code: 'protected term redefinition',
          fields: { term: 'issuer' },
        });
        expect(result).toEqual({
          keyword: 'jsonldSyntax',
          message:
            'Your @context redefines "issuer", which is a protected JSON-LD term. Either rename the term, or use a different @context that doesn\'t redefine it.',
          instancePath: '@context',
          params: { code: 'protected term redefinition', term: 'issuer' },
        });
      });

      it('explains keyword redefinition with the term name', () => {
        const result = describeJsonLdError({
          kind: 'document',
          source: 'syntax-error',
          detail: 'Invalid JSON-LD syntax; keywords cannot be overridden.',
          code: 'keyword redefinition',
          fields: { term: '@type' },
        });
        expect(result.keyword).toBe('jsonldSyntax');
        expect(result.message).toContain('redefines "@type", which is a JSON-LD keyword');
      });

      it('explains an invalid local context with the library message appended', () => {
        const result = describeJsonLdError({
          kind: 'document',
          source: 'syntax-error',
          detail: 'Invalid JSON-LD syntax; @context must be an object.',
          code: 'invalid local context',
        });
        expect(result.keyword).toBe('jsonldSyntax');
        expect(result.message).toBe(
          "The @context value isn't a valid JSON-LD context. Invalid JSON-LD syntax; @context must be an object.",
        );
      });

      it('falls back to the library message when no specific case matches', () => {
        const result = describeJsonLdError({
          kind: 'document',
          source: 'syntax-error',
          detail: 'Invalid JSON-LD syntax; @type value must be a string.',
          code: 'invalid type value',
          fields: { term: 'foo' },
        });
        expect(result.keyword).toBe('jsonldSyntax');
        expect(result.message).toBe('Invalid JSON-LD syntax; @type value must be a string. Term involved: "foo".');
      });
    });

    describe('document safe-mode events', () => {
      const event = (code: string, detail: string, fields?: Record<string, string>) => ({
        kind: 'document',
        source: 'safe-mode-event',
        detail,
        code,
        ...(fields && { fields }),
      });

      it('explains an unmapped property by name', () => {
        const result = describeJsonLdError(
          event('invalid property', 'Dropping property that did not expand into an absolute IRI or keyword.', {
            property: 'mediaQuery',
          }),
        );
        expect(result).toEqual({
          keyword: 'jsonldValidation',
          message:
            'Property "mediaQuery" appears in the credential but isn\'t defined by any @context. Either add a definition for it to a @context, or remove the property from the credential.',
          instancePath: '',
          params: {
            code: 'invalid property',
            property: 'mediaQuery',
            id: undefined,
            type: undefined,
            term: undefined,
            language: undefined,
          },
        });
      });

      it('explains a relative @id reference with the offending value', () => {
        const result = describeJsonLdError(
          event('relative @id reference', 'Relative @id reference found.', { id: 'foo/bar' }),
        );
        expect(result.keyword).toBe('jsonldValidation');
        expect(result.message).toContain('The id "foo/bar" is a relative reference');
      });

      it('explains a relative @type reference with the offending value', () => {
        const result = describeJsonLdError(
          event('relative @type reference', 'Relative @type reference found.', { type: 'Widget' }),
        );
        expect(result.message).toContain('The type "Widget" is a relative reference');
      });

      it('explains a reserved term with its name', () => {
        const result = describeJsonLdError(event('reserved term', 'Reserved term found.', { term: '@foo' }));
        expect(result.message).toContain('defines "@foo", which is reserved by JSON-LD');
      });

      it('explains an invalid language tag', () => {
        const result = describeJsonLdError(
          event('invalid @language value', 'Invalid @language value.', { language: 'en_US!' }),
        );
        expect(result.message).toContain('"en_US!" isn\'t a valid BCP-47 language tag');
      });

      it('falls back to the description detail when the code is unknown', () => {
        const result = describeJsonLdError(event('some new code', 'Something new happened.'));
        expect(result.keyword).toBe('jsonldValidation');
        expect(result.message).toBe('Something new happened.');
        expect(result.params?.code).toBe('some new code');
      });

      it('treats a document failure without a source as a safe-mode event', () => {
        const result = describeJsonLdError({ kind: 'document', detail: 'the document could not be expanded' });
        expect(result.keyword).toBe('jsonldValidation');
        expect(result.message).toBe('the document could not be expanded');
      });
    });

    describe('unknown shapes', () => {
      it('passes the detail through for an unrecognised kind', () => {
        const result = describeJsonLdError({ kind: 'request', detail: 'Body must carry a JSON object as "document".' });
        expect(result).toEqual({
          keyword: 'unknown',
          message: 'Body must carry a JSON object as "document".',
          instancePath: '',
          params: { kind: 'request', code: undefined },
        });
      });

      it('handles null/undefined input and shapes without a detail', () => {
        for (const input of [null, undefined, 'boom', { name: 'jsonld.InvalidUrl' }]) {
          const result = describeJsonLdError(input);
          expect(result.keyword).toBe('unknown');
          expect(result.message).toContain('returned no diagnostic information');
        }
      });
    });
  });

  describe('validateContext', () => {
    it('returns valid when expansion succeeds', async () => {
      const credential = { '@context': ['https://schema.org'], name: 'Test' };
      const expanded = [{ 'https://schema.org/name': [{ '@value': 'Test' }] }];
      answer(200, { ok: true, expanded });

      const result = await validateContext(credential);

      expect(result).toEqual({ valid: true, data: expanded });
      expect(fetchMock).toHaveBeenCalledWith('/api/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: credential }),
      });
    });

    it('returns the required-field error when @context is missing, without calling the service', async () => {
      const result = await validateContext({ id: '1234' });
      expect(fetchMock).not.toHaveBeenCalled();
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

    it('surfaces a clear message when the service reports an expansion failure', async () => {
      answer(422, {
        ok: false,
        error: {
          kind: 'document',
          source: 'safe-mode-event',
          detail: 'Dropping property that did not expand into an absolute IRI or keyword. (property: "mediaQuery")',
          code: 'invalid property',
          fields: { property: 'mediaQuery' },
        },
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

    it('translates a guard refusal the service relays into the existing URL error copy', async () => {
      answer(422, {
        ok: false,
        error: {
          kind: 'context-fetch',
          detail: "a remote @context URL was rejected by this service's URL policy or could not be resolved",
          url: 'https://internal.example/ctx.jsonld',
        },
      });
      const result = await validateContext({ '@context': ['https://internal.example/ctx.jsonld'] });
      expect(result.valid).toBe(false);
      expect(result.error?.keyword).toBe('jsonldUrl');
      expect(result.error?.message).toContain('https://internal.example/ctx.jsonld');
      expect(result.error?.message).toContain('rejected by this service');
    });

    it('reports the service being unreachable as a service problem, not a credential problem', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await validateContext({ '@context': ['https://www.w3.org/ns/credentials/v2'] });
      expect(result.valid).toBe(false);
      expect(result.error?.keyword).toBe('unknown');
      expect(result.error?.message).toContain('context service could not be reached');
    });

    it('reports an unreadable service answer with its status', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 502,
        json: async () => {
          throw new SyntaxError('bad');
        },
      } as unknown as Response);
      const result = await validateContext({ '@context': ['https://www.w3.org/ns/credentials/v2'] });
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain('answered 502');
    });
  });
});
