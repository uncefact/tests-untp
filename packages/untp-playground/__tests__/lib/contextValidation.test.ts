/**
 * @jest-environment node
 */
import {
  declaredContextUrls,
  describeJsonLdError,
  validateContext,
  validateRequiredFields,
} from '@/lib/contextValidation';
import { classifyJsonLdFailure } from '@/lib/artefactFailure';
import {
  describeJsonLdFailure,
  expandJsonLd,
  JsonLdExpansionFailedError,
  type JsonLdDocumentLoader,
} from '@uncefact/untp-utils/validation';
import { ResolverHttpError } from '@uncefact/untp-utils/resolvers';
import { TextDecoder, TextEncoder } from 'util';

Object.assign(globalThis, { TextDecoder, TextEncoder });

const fetchMock = jest.fn();
const routeLoaderMock = jest.fn<ReturnType<JsonLdDocumentLoader>, [string]>();

jest.mock('@uncefact/untp-utils/loaders', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/loaders');
  return { ...actual, createJsonLdDocumentLoader: jest.fn(() => (url: string) => routeLoaderMock(url)) };
});

import { POST } from '@/app/api/context/route';

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
    fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body } as unknown as Response);

  function contextRequest(credential: Record<string, unknown>): Request {
    return new Request('http://localhost/api/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: credential }),
    });
  }

  async function realJsonLdFailure(context: unknown, value: Record<string, unknown>, loadedContext: unknown = context) {
    const document = { '@context': context, ...value };
    const remoteDocument = { '@context': loadedContext };
    const error = await expandJsonLd(document, {
      documentLoader: async (url) => ({ documentUrl: url, document: remoteDocument }),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonLdExpansionFailedError);
    return classifyJsonLdFailure(describeJsonLdFailure(error as JsonLdExpansionFailedError), 'context');
  }

  async function answerWithRealJsonLdFailure(
    credential: Record<string, unknown>,
    documentLoader: JsonLdDocumentLoader,
  ) {
    routeLoaderMock.mockImplementation(documentLoader);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await POST(contextRequest(credential));
      const payload = (await response.json()) as { failure: Record<string, unknown> };
      expect(response.status).toBe(422);
      expect(payload.failure).toMatchObject({
        kind: 'context-fetch',
        code: 'resolver.http-error',
        upstreamStatus: 404,
      });
      answer(response.status, payload);
    } finally {
      warn.mockRestore();
    }
  }

  describe('declaredContextUrls', () => {
    it('collects the deepest URL from a 3,000-level scoped-context document', () => {
      const deepestUrl = 'https://publisher.example/context-3000.jsonld';
      let nestedContext: unknown = deepestUrl;
      for (let index = 0; index < 3_000; index += 1) {
        nestedContext = {
          [`term-${index}`]: {
            '@id': `https://example.test/term-${index}`,
            '@context': nestedContext,
          },
        };
      }

      const result = declaredContextUrls({ '@context': nestedContext, term: 'value' });

      expect(result.urls.has(deepestUrl)).toBe(true);
      expect(result.complete).toBe(true);
    });
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

    it('uses the document family in the missing-context message', async () => {
      const scheme = await validateContext({ id: 'x' }, 'scheme');
      expect(scheme.error?.message).toBe('Missing required "@context" property in scheme.');
      expect(scheme.failure?.message).toBe('Missing required "@context" property in scheme.');

      const credential = await validateContext({ id: 'x' });
      expect(credential.error?.message).toBe('Missing required "@context" property in credential.');
      expect(credential.failure?.message).toBe('Missing required "@context" property in credential.');
    });
  });

  describe('real JSON-LD diagnostics retain origin-independent classes', () => {
    it.each([
      ['invalid @language value', { '@language': 'en_US!' }, { name: 'value' }],
      ['invalid scoped context', { scoped: { '@id': 'https://example.test/scoped', '@context': 17 } }, { scoped: {} }],
      [
        'protected term redefinition',
        [
          { term: { '@id': 'https://example.test/term', '@protected': true } },
          { term: { '@id': 'https://example.test/other' } },
        ],
        { term: 'value' },
      ],
      ['reserved identifier', { term: { '@id': '@reserved' } }, { term: 'value' }],
    ])('classifies inline and remote %s the same way', async (_name, context, value) => {
      const inline = await realJsonLdFailure(context, value);
      const remote = await realJsonLdFailure('https://example.test/context.jsonld', value, context);
      expect(remote.class).toBe(inline.class);
    });

    it('includes a real JSON-LD event and its offending type in unknown copy', async () => {
      const failure = await realJsonLdFailure(
        { VerifiableCredential: 'https://example.test/VerifiableCredential' },
        { '@type': ['VerifiableCredential', 'UnsupportedType'] },
      );

      expect(failure).toMatchObject({ class: 'unknown', code: 'context.document.unknown' });
      expect(failure.message).toBe(
        'JSON-LD reported "relative @type reference" for "UnsupportedType"; the Playground cannot tell whether the credential or a remote context caused it.',
      );
      expect(failure.remediation).toBe('Report these details to the Playground operator.');
    });

    it('uses a valid language tag as a control for both inline and remote contexts', async () => {
      const context = { '@language': 'en-US', name: 'https://example.test/name' };
      await expect(
        expandJsonLd(
          { '@context': context, name: 'value' },
          { documentLoader: async (url) => ({ documentUrl: url, document: { '@context': context } }) },
        ),
      ).resolves.toEqual(expect.any(Array));
      await expect(
        expandJsonLd(
          { '@context': 'https://example.test/context.jsonld', name: 'value' },
          { documentLoader: async (url) => ({ documentUrl: url, document: { '@context': context } }) },
        ),
      ).resolves.toEqual(expect.any(Array));
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
            'Couldn\'t load the @context at "https://no-such-host.invalid/ctx.jsonld". Common causes: the URL is unreachable, is not https, resolves to a private address, redirected too many times, or returned a non-JSON-LD response. Reported cause: could not fetch a remote @context: HTTP 503 from https://no-such-host.invalid/ctx.jsonld.',
          instancePath: '@context',
          params: {
            kind: 'context-fetch',
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
          "Couldn't load a @context URL. Reported cause: a remote @context URL was rejected by this service's URL policy or could not be resolved.",
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
        expect(result.message).not.toContain('carrying');
        expect(result.params).toMatchObject({
          kind: 'context-invalid',
          code: 'invalid remote context',
          url: 'https://example.com/ctx',
        });
      });

      it('keeps provenance neutral when no context URL is available', () => {
        const result = describeJsonLdError({
          kind: 'context-invalid',
          detail: 'invalid scoped context',
          code: 'invalid scoped context',
        });
        expect(result.message).toContain('does not establish whether the context was fetched or where it came from');
        expect(result.message).not.toContain('fetched but');
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
          message: 'Your @context redefines "issuer", which is a protected JSON-LD term.',
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
          message: 'Property "mediaQuery" appears in the credential but isn\'t defined by any @context.',
          instancePath: '',
          params: { code: 'invalid property', property: 'mediaQuery' },
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
      it('reports a request or service failure as the service not judging the document', () => {
        const result = describeJsonLdError({ kind: 'request', detail: 'Body must carry a JSON object as "document".' });
        expect(result).toEqual({
          keyword: 'jsonldService',
          message:
            'The Playground\'s context service could not process the request: Body must carry a JSON object as "document".',
          instancePath: '',
          params: { kind: 'request' },
        });
        expect(describeJsonLdError({ kind: 'service', detail: 'internal' }).message).toContain(
          'could not process the request',
        );
      });

      it('treats an unrecognised kind as no diagnostic information', () => {
        const result = describeJsonLdError({ kind: 'something-new', detail: 'x' });
        expect(result.keyword).toBe('unknown');
        expect(result.message).toContain('returned no diagnostic information');
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
      answer(200, { expanded });

      const result = await validateContext(credential);

      expect(result).toEqual({ valid: true, data: expanded });
      expect(fetchMock).toHaveBeenCalledWith('/api/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: credential }),
        signal: expect.any(Object),
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
        failure: {
          class: 'credential-invalid',
          code: 'context.required',
          message: 'Missing required "@context" property in credential.',
          remediation: 'Add the missing "@context" field to the credential.',
        },
      });
    });

    it('surfaces a clear message when the service reports an expansion failure', async () => {
      answer(422, {
        error: 'x',
        failure: {
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

    it('treats a malformed failure envelope as a service failure', async () => {
      answer(422, { failure: { kind: 'document', code: 'invalid property' } });

      const result = await validateContext({ '@context': ['https://example.test/context.jsonld'] });

      expect(result.failure).toMatchObject({ class: 'could-not-fetch', code: 'context.service', serviceStatus: 422 });
      expect(result.failure).not.toHaveProperty('declaredVersion');
      expect(result.error?.message).toContain('answered 422');
    });

    it('rejects non-string diagnostic fields without rendering an object value', async () => {
      answer(422, {
        failure: {
          kind: 'document',
          code: 'invalid property',
          detail: 'bad property',
          fields: { property: {} },
        },
      });

      const result = await validateContext({ '@context': ['https://example.test/context.jsonld'] });

      expect(result.failure).toMatchObject({ class: 'could-not-fetch', code: 'context.service', serviceStatus: 422 });
      expect(JSON.stringify(result)).not.toContain('[object Object]');
    });

    it('rejects a diagnostic field with an unusable toString without throwing', async () => {
      answer(422, {
        failure: {
          kind: 'document',
          code: 'invalid property',
          detail: 'bad property',
          fields: { property: { toString: null } },
        },
      });

      await expect(validateContext({ '@context': ['https://example.test/context.jsonld'] })).resolves.toMatchObject({
        valid: false,
        failure: { class: 'could-not-fetch', code: 'context.service', serviceStatus: 422 },
      });
    });

    it('treats an empty 502 failure envelope as a service failure', async () => {
      answer(502, {});

      const result = await validateContext({ '@context': ['https://example.test/context.jsonld'] });

      expect(result.failure).toMatchObject({ class: 'could-not-fetch', code: 'context.service', serviceStatus: 502 });
      expect(result.error?.message).toContain('answered 502');
    });

    it('translates a guard refusal the service relays into the existing URL error copy', async () => {
      answer(422, {
        error: 'x',
        failure: {
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
      expect(result.error?.keyword).toBe('jsonldService');
      expect(result.error?.params).toEqual({ kind: 'unreachable' });
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
      expect(result.error?.keyword).toBe('jsonldService');
      expect(result.error?.message).toContain('answered 502');
    });

    it.each([
      ['unusable-artefact', 'resolver.invalid-json'],
      ['unknown', 'invalid scoped context'],
    ] as const)('keeps the service status on a remote-invalid %s result', async (failureClass, code) => {
      const url = 'https://publisher.example/context.jsonld';
      answer(422, {
        failure: {
          kind: 'context-invalid',
          code,
          url,
          detail: 'the remote context was not usable',
        },
      });

      const result = await validateContext({ '@context': [url] });

      expect(result.failure).toMatchObject({
        class: failureClass,
        code: 'context.invalid',
        artefactUrl: url,
        serviceStatus: 422,
      });
    });

    it('keeps the service status on a document invalid-property result', async () => {
      answer(422, {
        failure: {
          kind: 'document',
          source: 'safe-mode-event',
          code: 'invalid property',
          detail: 'bad property',
          fields: { property: 'unknownTerm' },
        },
      });

      const result = await validateContext({ '@context': ['https://example.test/context.jsonld'] });

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.document.invalid-property',
        serviceStatus: 422,
      });
    });

    it('keeps the service status on a terminal document-unknown result', async () => {
      answer(422, {
        failure: {
          kind: 'document',
          source: 'safe-mode-event',
          code: 'invalid @language value',
          detail: 'bad language',
          fields: { language: 'en_US!' },
        },
      });

      const result = await validateContext({ '@context': ['https://example.test/context.jsonld'] });

      expect(result.failure).toMatchObject({
        class: 'unknown',
        code: 'context.document.unknown',
        serviceStatus: 422,
      });
    });

    it('times out while the context service response body is still being read', async () => {
      jest.useFakeTimers();
      try {
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () =>
                  reject(Object.assign(new Error('body read aborted'), { name: 'AbortError' })),
                );
              }),
          }),
        );

        const pending = validateContext({ '@context': ['https://www.w3.org/ns/credentials/v2'] });
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(15_000);
        const result = await pending;
        expect(result.valid).toBe(false);
        expect(result.error?.keyword).toBe('jsonldService');
        expect(result.error?.message).toContain('answered 200');
        expect(result.error?.message).toContain('did not finish arriving within 15s');
        expect(result.error?.message).not.toContain('did not respond');
        expect(result.failure).toMatchObject({
          class: 'could-not-fetch',
          code: 'context.service',
          serviceStatus: 200,
          message:
            "The Playground's context service answered 200 but the result did not finish arriving within 15s. Retry in a moment.",
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it.each([[{}], [{ expanded: 'bad' }], [null]])(
      'refuses a 200 whose body is not an expanded array (%j)',
      async (body) => {
        answer(200, body);
        const result = await validateContext({ '@context': ['https://www.w3.org/ns/credentials/v2'] });
        expect(result.valid).toBe(false);
        expect(result.error?.keyword).toBe('jsonldService');
        expect(result.error?.message).toContain('without an expanded document');
      },
    );

    it.each([403, 404, 410])('classifies a declared context HTTP %s at the producer', async (status) => {
      const url = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
      answer(422, {
        error: 'context host rejected the request',
        failure: {
          kind: 'context-fetch',
          code: 'resolver.http-error',
          upstreamStatus: status,
          url,
          detail: `could not fetch a remote @context: HTTP ${status}`,
        },
      });

      const result = await validateContext({ '@context': [url] });

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: url,
        upstreamStatus: status,
        declaredVersion: '0.7.0',
        serviceStatus: 422,
      });
      expect(result.failure?.message).toContain(`HTTP status ${status}`);
      expect(result.failure?.remediation).toContain('@context version 0.7.0');
    });

    it.each([408, 429])('keeps a declared context HTTP %s as could-not-fetch at the producer', async (status) => {
      const url = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
      answer(422, {
        error: 'context host returned a retryable status',
        failure: {
          kind: 'context-fetch',
          code: 'resolver.http-error',
          upstreamStatus: status,
          url,
          detail: `could not fetch a remote @context: HTTP ${status}`,
        },
      });

      const result = await validateContext({ '@context': [url] });

      expect(result.failure).toMatchObject({
        class: 'could-not-fetch',
        code: 'context.fetch',
        artefactUrl: url,
        upstreamStatus: status,
      });
      expect(result.failure).not.toHaveProperty('declaredVersion');
    });

    it('classifies a declared third-party context HTTP 404 without claiming the detected UNTP version', async () => {
      const untpUrl = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
      const thirdPartyUrl = 'https://publisher.example/context.jsonld';
      answer(422, {
        error: 'context host rejected the request',
        failure: {
          kind: 'context-fetch',
          code: 'resolver.http-error',
          upstreamStatus: 404,
          url: thirdPartyUrl,
          detail: 'could not fetch a remote @context: HTTP 404',
        },
      });

      const result = await validateContext({ '@context': [untpUrl, thirdPartyUrl] });

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: thirdPartyUrl,
        upstreamStatus: 404,
        message: `No context is published at ${thirdPartyUrl} (status 404). Check the credential's @context entry.`,
        remediation: `Check the credential's @context entry for ${thirdPartyUrl}.`,
        serviceStatus: 422,
      });
      expect(result.failure).not.toHaveProperty('declaredVersion');
    });

    it('keeps a declared context 503 as could-not-fetch at the producer', async () => {
      const url = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
      answer(422, {
        error: 'context host failed',
        failure: {
          kind: 'context-fetch',
          code: 'resolver.http-error',
          upstreamStatus: 503,
          url,
          detail: 'could not fetch a remote @context: HTTP 503',
        },
      });

      const result = await validateContext({ '@context': [url] });

      expect(result.failure).toMatchObject({
        class: 'could-not-fetch',
        code: 'context.fetch',
        artefactUrl: url,
        upstreamStatus: 503,
        serviceStatus: 422,
      });
    });

    it('treats a nested declared context URL as the failing declared artefact', async () => {
      const declaredUrl = 'https://publisher.example/context-a.jsonld';
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      const credential = {
        '@context': declaredUrl,
        child: { '@context': dependencyUrl, name: 'Test' },
      };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        if (url === declaredUrl) {
          return {
            documentUrl: url,
            document: {
              '@context': {
                nested: 'https://example.test/nested',
                child: 'https://example.test/child',
                name: 'https://example.test/name',
              },
            },
          };
        }
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
        serviceStatus: 422,
      });
      expect(result.failure?.message).toContain(`No context is published at ${dependencyUrl}`);
      expect(result.failure?.message).not.toContain('depends on');
    });

    it('names the declared context when it imports a missing dependency', async () => {
      const declaredUrl = 'https://publisher.example/context-a.jsonld';
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      const credential = { '@context': declaredUrl, name: 'Test' };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        if (url === declaredUrl) return { documentUrl: url, document: { '@context': { '@import': dependencyUrl } } };
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'could-not-fetch',
        code: 'context.fetch',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
        serviceStatus: 422,
        remediation: `The context at ${declaredUrl} depends on ${dependencyUrl}, which its publisher has not published. Report it to that publisher.`,
      });
      expect(result.failure?.message).toContain(`declared context "${declaredUrl}"`);
    });

    it('collects a top-level context after 10,000 padding values', async () => {
      const contextUrl = 'https://publisher.example/context-b.jsonld';
      const credential = {
        padding: Array.from({ length: 10_000 }, (_, index) => index),
        '@context': contextUrl,
        name: 'Test',
      };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: contextUrl,
        upstreamStatus: 404,
      });
      expect(result.failure?.message).toContain(contextUrl);
    });

    it('collects nested scoped-context term definitions and classifies the deepest URL', async () => {
      // In this Jest environment, native JSON.stringify first throws at depth 2,710; 1,355 is about half that depth.
      const deepestUrl = 'https://publisher.example/context-1355.jsonld';
      let nestedContext: unknown = deepestUrl;
      for (let index = 0; index < 1_355; index += 1) {
        nestedContext = {
          [`term-${index}`]: {
            '@id': `https://example.test/term-${index}`,
            '@context': nestedContext,
          },
        };
      }
      const credential = { '@context': nestedContext, term: 'value' };
      answer(422, {
        failure: {
          kind: 'context-fetch',
          code: 'resolver.http-error',
          url: deepestUrl,
          upstreamStatus: 404,
          detail: `could not fetch a remote @context: ${deepestUrl} returned status 404.`,
        },
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: deepestUrl,
        upstreamStatus: 404,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ document: credential }));
    });

    it('keeps a truncated walk neutral for a nested missing dependency', async () => {
      const declaredUrl = 'https://publisher.example/context-a.jsonld';
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      let nested: Record<string, unknown> = { '@context': dependencyUrl };
      for (let index = 0; index < 40; index += 1) nested = { child: nested };
      const credential = { '@context': declaredUrl, child: nested, name: 'Test' };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        if (url === declaredUrl) {
          return {
            documentUrl: url,
            document: { '@context': { child: 'https://example.test/child', name: 'https://example.test/name' } },
          };
        }
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'could-not-fetch',
        code: 'context.fetch',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
      });
      expect(result.failure?.message).toContain(
        'The document is too large for the Playground to trace which context imported it.',
      );
      expect(result.failure?.message).not.toContain('depends on');
      expect(result.failure?.message).not.toContain('imported by a declared context');
      expect(result.failure?.remediation).not.toContain('depends on');
      expect(result.failure?.remediation).not.toContain('imported by a declared context');
    });

    it.each([
      ['a term IRI', { term: 'https://publisher.example/context-b.jsonld' }],
      ['an @vocab value', { '@vocab': 'https://publisher.example/context-b.jsonld' }],
      ['an @base value', { '@base': 'https://publisher.example/context-b.jsonld' }],
    ] as const)('does not treat %s as a declared context', async (_name, contextDefinition) => {
      const declaredUrl = 'https://publisher.example/context-a.jsonld';
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      const credential = { '@context': [declaredUrl, contextDefinition], name: 'Test' };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        if (url === declaredUrl) return { documentUrl: url, document: { '@context': { '@import': dependencyUrl } } };
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'could-not-fetch',
        code: 'context.fetch',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
        remediation: `The context at ${declaredUrl} depends on ${dependencyUrl}, which its publisher has not published. Report it to that publisher.`,
      });
      expect(result.failure).not.toMatchObject({ class: 'credential-invalid' });
    });

    it('collects a direct @import context reference', async () => {
      const declaredUrl = 'https://publisher.example/context-a.jsonld';
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      const credential = { '@context': [declaredUrl, { '@import': dependencyUrl }], name: 'Test' };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        if (url === declaredUrl)
          return { documentUrl: url, document: { '@context': { name: 'https://example.test/name' } } };
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
      });
      expect(result.failure?.message).toContain(dependencyUrl);
    });

    it('collects a scoped @context inside a term definition', async () => {
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      const credential = {
        '@context': {
          term: { '@id': 'https://example.test/term', '@context': dependencyUrl },
        },
        term: 'value',
      };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'credential-invalid',
        code: 'context.fetch.not-published',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
      });
      expect(result.failure?.message).toContain(dependencyUrl);
    });

    it('uses the parent-unknown fallback for a dependency with multiple declared contexts', async () => {
      const declaredUrl = 'https://publisher.example/context-a.jsonld';
      const secondDeclaredUrl = 'https://publisher.example/context-c.jsonld';
      const dependencyUrl = 'https://publisher.example/context-b.jsonld';
      const credential = { '@context': [declaredUrl, secondDeclaredUrl], name: 'Test' };

      await answerWithRealJsonLdFailure(credential, async (url) => {
        if (url === declaredUrl) return { documentUrl: url, document: { '@context': { '@import': dependencyUrl } } };
        if (url === secondDeclaredUrl) return { documentUrl: url, document: { '@context': {} } };
        throw new ResolverHttpError(url, 404);
      });

      const result = await validateContext(credential);

      expect(result.failure).toMatchObject({
        class: 'could-not-fetch',
        code: 'context.fetch',
        artefactUrl: dependencyUrl,
        upstreamStatus: 404,
        serviceStatus: 422,
        message: `The context dependency at "${dependencyUrl}" returned HTTP status 404; it was imported by a declared context.`,
        remediation: `The context at ${dependencyUrl} is imported by a declared context, but its publisher has not published it. Report it to that publisher.`,
      });
    });
  });
});
