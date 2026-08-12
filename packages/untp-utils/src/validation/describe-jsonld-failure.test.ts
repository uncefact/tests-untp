import { describeJsonLdFailure } from './describe-jsonld-failure.js';
import { JsonLdExpansionFailedError, JsonLdInvalidShapeError } from './errors.js';
import { ResolverHttpError, ResolverTimedOutError } from '../resolvers/errors.js';
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

  describe('context-fetch: fetched but unusable remote contexts', () => {
    it('classifies non-object remote context content as context-fetch with a generic message', () => {
      const processor = jsonLdError(
        'jsonld.InvalidUrl',
        'Dereferencing a URL did not result in a JSON object. The response was valid JSON, but it was not a JSON object. URL: "https://example.com/ctx".',
        { code: 'invalid remote context' },
      );

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure.kind).toBe('context-fetch');
      expect(failure.detail).toBe('a remote @context document was fetched but could not be used as a context');
    });

    it('leaves the shared "loading remote context failed" code document-class for other error names', () => {
      // jsonld.ContextUrlError reuses the code for the JSON-LD 1.0 context
      // limit; only jsonld.InvalidUrl carries the remote-content meaning.
      const processor = jsonLdError('jsonld.ContextUrlError', 'Maximum number of @context URLs exceeded.', {
        code: 'loading remote context failed',
      });

      expect(describeJsonLdFailure(new JsonLdExpansionFailedError(processor))).toMatchObject({ kind: 'document' });
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
    });

    it('passes a jsonld syntax-error message through (library-authored fixed strings)', () => {
      const processor = jsonLdError('jsonld.SyntaxError', 'Invalid JSON-LD syntax; @type value must be a string.', {
        code: 'invalid type value',
      });

      const failure = describeJsonLdFailure(new JsonLdExpansionFailedError(processor));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toBe('Invalid JSON-LD syntax; @type value must be a string.');
    });

    it('keeps the typed invalid-shape diagnostic', () => {
      const failure = describeJsonLdFailure(new JsonLdInvalidShapeError(null));

      expect(failure.kind).toBe('document');
      expect(failure.detail).toContain('non-null object');
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
