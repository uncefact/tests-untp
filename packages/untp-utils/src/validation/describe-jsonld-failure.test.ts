import { describeJsonLdFailure } from './describe-jsonld-failure.js';
import { JsonLdExpansionFailedError, JsonLdInvalidShapeError } from './errors.js';
import { ResolverHttpError, ResolverInvalidJsonError, ResolverTimedOutError } from '../resolvers/errors.js';
import { PrivateAddressError, ResolutionFailedError } from '../node/errors.js';

/** Builds an error shaped like jsonld.js's JsonLdError (which never sets native `cause`). */
function jsonLdError(name: string, message: string, details?: Record<string, unknown>): Error {
  const error = new Error(message) as Error & { details?: Record<string, unknown> };
  error.name = name;
  error.details = details;
  return error;
}

describe('describeJsonLdFailure', () => {
  describe('context-fetch: typed loader failures', () => {
    it('classifies an HTTP failure on the cause chain as context-fetch, naming URL and status', () => {
      const http = new ResolverHttpError('https://www.w3.org/ns/credentials/v2', 429);
      const wrapped = new JsonLdExpansionFailedError(new Error('jsonld wrapper', { cause: http }));

      const failure = describeJsonLdFailure(wrapped);

      expect(failure.kind).toBe('context-fetch');
      expect(failure.detail).toContain('https://www.w3.org/ns/credentials/v2');
      expect(failure.detail).toContain('429');
      expect(failure.code).toBe(http.code);
    });

    it('classifies a timeout on the cause chain as context-fetch', () => {
      const wrapped = new JsonLdExpansionFailedError(new ResolverTimedOutError('https://example.com/ctx', 10_000));

      expect(describeJsonLdFailure(wrapped)).toMatchObject({ kind: 'context-fetch' });
    });

    it.each([
      ['PrivateAddressError', new PrivateAddressError('https://internal.example/ctx', ['10.0.0.5'])],
      ['ResolutionFailedError', new ResolutionFailedError('https://nxdomain.example/ctx', new Error('ENOTFOUND'))],
    ])('collapses %s to one flat message, leaking neither the URL nor the rejection class', (_name, rejected) => {
      const wrapped = new JsonLdExpansionFailedError(new Error('scoped context', { cause: rejected }));

      const failure = describeJsonLdFailure(wrapped);

      expect(failure.kind).toBe('context-fetch');
      // One message for every UrlValidationError subclass: distinguishing
      // "does not resolve" from "resolves privately" would be a per-hostname
      // reconnaissance oracle. The typed detail stays on the cause chain.
      expect(failure.detail).toBe(
        "a remote @context URL was rejected by this service's URL policy or could not be resolved",
      );
      expect(failure.detail).not.toMatch(/10\.0\.0\.5|internal\.example|nxdomain\.example/);
      expect(failure.code).toBeUndefined();
    });

    it('prefers the flat loader message over the URL-bearing jsonld wrapper above it (rehydrated chain shape)', () => {
      // The real chain after validateJsonLd rehydration: the loader error
      // hangs BENEATH jsonld.InvalidUrl, whose message contains the URL.
      const loaderError = new PrivateAddressError('https://169.254.169.254/latest/meta-data/', ['169.254.169.254']);
      const wrapper = jsonLdError(
        'jsonld.InvalidUrl',
        'Dereferencing a URL did not result in a valid JSON-LD object. URL: "https://169.254.169.254/latest/meta-data/".',
        { code: 'loading remote context failed' },
      );
      wrapper.cause = loaderError;
      const wrapped = new JsonLdExpansionFailedError(wrapper);

      const failure = describeJsonLdFailure(wrapped);

      expect(failure.kind).toBe('context-fetch');
      expect(failure.detail).not.toContain('169.254.169.254');
    });

    it('finds a typed failure at any depth of the cause chain', () => {
      let chain: Error = new ResolverHttpError('https://example.com/ctx', 503) as unknown as Error;
      for (let i = 0; i < 20; i += 1) {
        chain = new Error(`wrapper ${i}`, { cause: chain });
      }

      expect(describeJsonLdFailure(new JsonLdExpansionFailedError(chain))).toMatchObject({ kind: 'context-fetch' });
    });
  });

  describe('context-invalid: fetched but unusable remote contexts', () => {
    it('classifies a response body that is not JSON as context-invalid, ahead of the general resolver branch', () => {
      const invalid = new ResolverInvalidJsonError('https://example.com/ctx', new SyntaxError('Unexpected token <'));
      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(new Error('wrapper', { cause: invalid })));
      expect(failure).toMatchObject({ kind: 'context-invalid', code: 'resolver.invalid-json' });
      expect(failure.detail).not.toContain('Unexpected token');
    });

    it('classifies an unusable term-scoped remote context as context-invalid with the term', () => {
      const processor = jsonLdError('jsonld.SyntaxError', 'Invalid JSON-LD syntax; invalid scoped context.', {
        code: 'invalid scoped context',
        term: 'x',
      });
      expect(describeJsonLdFailure(new JsonLdExpansionFailedError(processor))).toEqual({
        kind: 'context-invalid',
        detail: 'a remote @context response could not be used as a JSON-LD context',
        code: 'invalid scoped context',
        fields: { term: 'x' },
      });
    });

    it('classifies a remote context chain that overflows or refers to itself as context-fetch', () => {
      const processor = jsonLdError('jsonld.ContextUrlError', 'Maximum number of @context URLs exceeded.', {
        code: 'context overflow',
        url: 'https://example.com/ctx',
      });
      expect(describeJsonLdFailure(new JsonLdExpansionFailedError(processor))).toEqual({
        kind: 'context-fetch',
        detail:
          'the remote @context chain could not be resolved: too many remote contexts, or a remote context refers back to itself',
        code: 'context overflow',
      });
    });

    it('classifies non-object remote context content as context-invalid, naming the code and URL', () => {
      const processor = jsonLdError(
        'jsonld.InvalidUrl',
        'Dereferencing a URL did not result in a JSON object. The response was valid JSON, but it was not a JSON object. URL: "https://example.com/ctx".',
        { code: 'invalid remote context', url: 'https://example.com/ctx' },
      );

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure).toEqual({
        kind: 'context-invalid',
        detail: 'a remote @context response could not be used as a JSON-LD context',
        code: 'invalid remote context',
        url: 'https://example.com/ctx',
      });
    });

    it('reports the failing @context URL from the jsonld wrapper beneath a typed loader failure', () => {
      const wrapper = jsonLdError(
        'jsonld.InvalidUrl',
        'Dereferencing a URL did not result in a valid JSON-LD object.',
        {
          code: 'loading remote context failed',
          url: 'https://example.com/ctx',
        },
      );
      wrapper.cause = new ResolverHttpError('https://example.com/ctx', 503);

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(wrapper));

      expect(failure).toMatchObject({
        kind: 'context-fetch',
        code: 'resolver.http-error',
        url: 'https://example.com/ctx',
      });
    });

    it('classifies an untyped "loading remote context failed" as context-fetch without echoing the message', () => {
      const wrapper = jsonLdError(
        'jsonld.InvalidUrl',
        'Dereferencing a URL did not result in a valid JSON-LD object.',
        {
          code: 'loading remote context failed',
          url: 'https://example.com/ctx',
        },
      );

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(wrapper));

      expect(failure).toEqual({
        kind: 'context-fetch',
        detail: 'a remote @context document could not be loaded',
        code: 'loading remote context failed',
        url: 'https://example.com/ctx',
      });
    });
  });

  describe('document: recognised processor shapes', () => {
    it('extracts the safe-mode event message and offending property (real jsonld@8.3.3 shape)', () => {
      const processor = jsonLdError('jsonld.ValidationError', 'Safe mode validation error.', {
        event: {
          type: ['JsonLdEvent'],
          code: 'invalid property',
          level: 'warning',
          message: 'Dropping property that did not expand into an absolute IRI or keyword.',
          details: { property: 'unknownTerm', expandedProperty: 'unknownTerm' },
        },
      });

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toContain('Dropping property that did not expand');
      expect(failure.detail).toContain('unknownTerm');
      expect(failure).toMatchObject({ source: 'safe-mode-event' });
      expect(failure.code).toBe('invalid property');
      expect(failure).toMatchObject({ fields: { property: 'unknownTerm', expandedProperty: 'unknownTerm' } });
    });

    it('never echoes non-allowlisted event fields, which can carry credential content', () => {
      const processor = jsonLdError('jsonld.ValidationError', 'Safe mode validation error.', {
        event: {
          code: 'object with only @id',
          message: 'Dropping object with only @id.',
          details: { value: { '@id': 'urn:secret:batch-7734' } },
        },
      });

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure.kind).toBe('document');
      expect(failure.detail).not.toContain('urn:secret:batch-7734');
      expect(failure).not.toHaveProperty('fields');
      expect(JSON.stringify(failure)).not.toContain('urn:secret:batch-7734');
    });

    it('echoes only allowlisted event fields even when a non-allowlisted one is a plain string', () => {
      const processor = jsonLdError('jsonld.ValidationError', 'Safe mode validation error.', {
        event: {
          code: 'invalid property',
          message: 'Dropping property that did not expand into an absolute IRI or keyword.',
          details: { property: 'batchId', value: 'urn:secret:batch-7734' },
        },
      });

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure).toMatchObject({ fields: { property: 'batchId' } });
      expect(JSON.stringify(failure)).not.toContain('urn:secret:batch-7734');
    });

    it('never echoes a syntax-error message, which jsonld.js may interpolate caller values into', () => {
      const processor = jsonLdError(
        'jsonld.SyntaxError',
        'Invalid JSON-LD syntax; container mapping for "secret-field-value" on term "x".',
        { code: 'invalid @index value', term: 'x' },
      );

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure).toEqual({
        kind: 'document',
        detail: 'Invalid JSON-LD syntax; invalid @index value.',
        source: 'syntax-error',
        code: 'invalid @index value',
        fields: { term: 'x' },
      });
      expect(JSON.stringify(failure)).not.toContain('secret-field-value');
    });

    it('classifies a syntax error from a code and its allowlisted fields', () => {
      const processor = jsonLdError('jsonld.SyntaxError', 'Invalid JSON-LD syntax; @type value must be a string.', {
        code: 'invalid type value',
      });

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toBe('Invalid JSON-LD syntax; invalid type value.');
      expect(failure).toMatchObject({ source: 'syntax-error' });
      expect(failure.code).toBe('invalid type value');
    });

    it('keeps the typed invalid-shape diagnostic', () => {
      const failure = describeJsonLdFailure(new JsonLdInvalidShapeError(null));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toContain('non-null object');
      expect(failure.code).toBe('invalid document shape');
    });
  });

  describe('document: unrecognised failures never leak raw messages', () => {
    it('returns the generic message for an untyped error instead of echoing its text', () => {
      const leaky = new Error('internal path /srv/app/private-config.json');

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(leaky));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toBe('the document could not be expanded as valid JSON-LD');
      expect(failure.detail).not.toContain('/srv/app');
    });

    it('returns the generic message for an unknown jsonld.* error name', () => {
      const processor = jsonLdError('jsonld.OptionsError', 'Some future message naming internals.', {});

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toBe('the document could not be expanded as valid JSON-LD');
    });

    it('terminates on a cyclic cause chain and classifies it as document', () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      a.cause = b;

      expect(describeJsonLdFailure(new JsonLdExpansionFailedError(a))).toMatchObject({
        kind: 'document',
        detail: 'the document could not be expanded as valid JSON-LD',
      });
    });
  });
});
