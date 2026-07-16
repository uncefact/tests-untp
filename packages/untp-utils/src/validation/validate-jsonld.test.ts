import { jest } from '@jest/globals';
import { createInMemoryTtlCache } from '../cache/in-memory-ttl-cache.js';
import type { LoadedRemoteDocument } from '../loaders/jsonld-document-loader.js';
import { JsonLdExpansionFailedError, JsonLdInvalidShapeError, JsonLdValidationError } from './errors.js';

const toRDF = jest.fn();
const documentLoader = jest.fn();
const createJsonLdDocumentLoader = jest.fn(() => documentLoader);

jest.unstable_mockModule('jsonld', () => ({
  default: { toRDF },
  toRDF,
}));

// The loader factory is mocked so this suite can assert the option threading
// (contextCache -> cache) without invoking the real resolver stack; the
// factory's own behaviour is covered in loaders/jsonld-document-loader.test.ts.
jest.unstable_mockModule('../loaders/jsonld-document-loader.js', () => ({
  createJsonLdDocumentLoader,
}));

const { validateJsonLd } = await import('./validate-jsonld.js');

describe('validateJsonLd', () => {
  beforeEach(() => {
    toRDF.mockReset();
    documentLoader.mockReset();
    createJsonLdDocumentLoader.mockClear();
  });

  it('returns void when JSON-LD expansion succeeds', async () => {
    toRDF.mockResolvedValue([] as never);

    await expect(validateJsonLd({ '@context': 'https://example.com' })).resolves.toBeUndefined();
    expect(toRDF).toHaveBeenCalledWith(
      { '@context': 'https://example.com' },
      expect.objectContaining({ safe: true, documentLoader: expect.any(Function) }),
    );
  });

  it('throws JsonLdExpansionFailedError when toRDF rejects', async () => {
    toRDF.mockRejectedValue(new Error('Invalid JSON-LD') as never);

    await expect(validateJsonLd({})).rejects.toMatchObject({
      name: 'JsonLdExpansionFailedError',
      code: 'jsonld.expansion-failed',
      received: 'Invalid JSON-LD',
    });
  });

  it('captures the original error on Error.cause', async () => {
    const cause = new Error('Missing @context');
    toRDF.mockRejectedValue(cause as never);

    await expect(validateJsonLd({})).rejects.toMatchObject({ cause });
  });

  describe('rehydrating a buried jsonld.js loader error', () => {
    // jsonld.js's own JsonLdError stores a document loader's rejection at
    // the proprietary `details.cause` and never sets native `Error.cause`
    // (jsonld@8.3.3 `lib/JsonLdError.js`, loader wrap in
    // `lib/ContextResolver.js`). `validateJsonLd` rehydrates it onto the
    // caught error's native `cause` so a plain `.cause` walk reaches it,
    // matching the schema-fetch path (see `validate-jsonld.ssrf.test.ts`).

    it('rehydrates the buried loader error onto the native cause chain', async () => {
      const buried = new Error('SSRF rejected');
      const jsonldError = Object.assign(new Error('Dereferencing a URL did not result in a valid JSON-LD object.'), {
        name: 'jsonld.InvalidUrl',
        details: { code: 'loading remote context failed', url: 'https://internal.example', cause: buried },
      });
      toRDF.mockRejectedValue(jsonldError as never);

      const error = await validateJsonLd({}).catch((e: unknown) => e);

      expect((error as JsonLdExpansionFailedError).cause).toBe(jsonldError);
      // Without the rehydration, jsonldError.cause stays unset (jsonld.js
      // never sets it), so this hop would be absent.
      expect(jsonldError.cause).toBe(buried);
    });

    it('does not add a spurious cause when the jsonld error has no buried loader error', async () => {
      // A malformed @context never reaches the document loader, so jsonld.js's
      // details carry no `cause` to rehydrate.
      const jsonldError = Object.assign(new Error('Invalid JSON-LD syntax; @context must be an object.'), {
        name: 'jsonld.SyntaxError',
        details: { code: 'invalid @context' },
      });
      toRDF.mockRejectedValue(jsonldError as never);

      await validateJsonLd({}).catch(() => undefined);

      // Asserts absence, not merely `undefined`: an implementation that sets
      // `error.cause = undefined` unconditionally would pass a `toBeUndefined()`
      // check but still fabricate a `cause` property that was never there.
      expect('cause' in jsonldError).toBe(false);
    });

    it('does not clobber an existing native cause on the jsonld error', async () => {
      const existingCause = new Error('existing, legitimate native cause');
      const buried = new Error('buried loader error, must not overwrite the existing cause');
      const jsonldError = Object.assign(new Error('wrapped', { cause: existingCause }), {
        name: 'jsonld.InvalidUrl',
        details: { cause: buried },
      });
      toRDF.mockRejectedValue(jsonldError as never);

      await validateJsonLd({}).catch(() => undefined);

      expect(jsonldError.cause).toBe(existingCause);
    });

    // A term's own remote @context (a JSON-LD 1.1 "scoped context") is
    // resolved through the same document loader, but on failure jsonld.js's
    // scoped-context branch (lib/context.js) discards the loader's error
    // entirely and throws a fresh JsonLdError with no `details.cause` at
    // all (see validate-jsonld.ssrf.test.ts for the real-jsonld
    // reproduction). validateJsonLd recovers it by tracking the last error
    // the document loader threw during the call and using that as a
    // fallback cause.
    describe('recovering via the tracked-loader fallback', () => {
      /** Simulates toRDF calling the documentLoader it was given, then rejecting as jsonld.js would. */
      function rejectAfterCallingLoader(url: string, rejection: unknown) {
        toRDF.mockImplementation(async (...args: unknown[]) => {
          const opts = args[1] as { documentLoader: (u: string) => Promise<unknown> };
          await opts.documentLoader(url).catch(() => undefined);
          throw rejection;
        });
      }

      it('recovers the tracked loader error when the jsonld error has no buried cause of its own', async () => {
        const loaderError = new Error('SSRF rejected, recorded from the tracked loader');
        documentLoader.mockRejectedValue(loaderError as never);
        const scopedContextError = Object.assign(new Error('Invalid JSON-LD syntax; invalid scoped context.'), {
          name: 'jsonld.SyntaxError',
          details: { code: 'invalid scoped context', context: 'https://internal.example', term: 'myTerm' },
        });
        rejectAfterCallingLoader('https://internal.example', scopedContextError);

        await validateJsonLd({}).catch(() => undefined);

        // Without the fallback, this jsonld error's details carry no `cause`
        // at all, so scopedContextError.cause would stay unset.
        expect(scopedContextError.cause).toBe(loaderError);
      });

      it('prefers the buried details.cause over the fallback when jsonld.js kept both', async () => {
        const buried = new Error('buried on details.cause, should win');
        const fallbackLoaderError = new Error('recorded from the tracked loader, should lose');
        documentLoader.mockRejectedValue(fallbackLoaderError as never);
        const jsonldError = Object.assign(new Error('wrapped'), {
          name: 'jsonld.InvalidUrl',
          details: { cause: buried },
        });
        rejectAfterCallingLoader('https://example.com', jsonldError);

        await validateJsonLd({}).catch(() => undefined);

        expect(jsonldError.cause).toBe(buried);
      });

      it('does not fabricate a cause when the loader never threw during the call', async () => {
        // The loader succeeds (or is never called); the eventual rejection
        // is for an unrelated reason, so there is nothing to fall back to.
        documentLoader.mockResolvedValue({ documentUrl: 'https://example.com', document: {} } as never);
        const unrelatedError = Object.assign(new Error('Invalid JSON-LD syntax; @context must be an object.'), {
          name: 'jsonld.SyntaxError',
          details: { code: 'invalid @context' },
        });
        rejectAfterCallingLoader('https://example.com', unrelatedError);

        await validateJsonLd({}).catch(() => undefined);

        expect('cause' in unrelatedError).toBe(false);
      });
    });
  });

  it('throws JsonLdInvalidShapeError when the document is not an object', async () => {
    await expect(validateJsonLd('not-an-object')).rejects.toMatchObject({
      name: 'JsonLdInvalidShapeError',
      code: 'jsonld.invalid-shape',
      received: 'string',
      expected: 'object',
    });
    expect(toRDF).not.toHaveBeenCalled();
  });

  it('throws JsonLdInvalidShapeError for null input', async () => {
    await expect(validateJsonLd(null)).rejects.toMatchObject({
      name: 'JsonLdInvalidShapeError',
      received: 'null',
    });
  });

  it('passes safe: false to toRDF when options.safe is false', async () => {
    toRDF.mockResolvedValue([] as never);

    await validateJsonLd({ '@context': 'https://example.com' }, { safe: false });

    expect(toRDF).toHaveBeenCalledWith(
      { '@context': 'https://example.com' },
      expect.objectContaining({ safe: false, documentLoader: expect.any(Function) }),
    );
  });

  it('defaults safe to true when no options provided', async () => {
    toRDF.mockResolvedValue([] as never);

    await validateJsonLd({ '@context': 'https://example.com' });

    expect(toRDF).toHaveBeenCalledWith(
      { '@context': 'https://example.com' },
      expect.objectContaining({ safe: true, documentLoader: expect.any(Function) }),
    );
  });

  it('creates the document loader with the supplied contextCache', async () => {
    toRDF.mockResolvedValue([] as never);
    const contextCache = createInMemoryTtlCache<LoadedRemoteDocument>({ ttlMs: 60_000 });

    await validateJsonLd({ '@context': 'https://example.com' }, { contextCache });

    expect(createJsonLdDocumentLoader).toHaveBeenCalledWith({ cache: contextCache });
  });

  it('passes toRDF a loader that delegates to the one createJsonLdDocumentLoader created', async () => {
    toRDF.mockResolvedValue([] as never);
    const remoteDoc = { documentUrl: 'https://example.com', document: {} };
    documentLoader.mockResolvedValue(remoteDoc as never);

    await validateJsonLd({ '@context': 'https://example.com' });

    expect(createJsonLdDocumentLoader).toHaveBeenCalledWith({ cache: undefined });
    // validateJsonLd wraps the created loader (to record failures for
    // rehydrateJsonLdCause's fallback, see validate-jsonld.ts), so toRDF
    // receives a different function reference; assert delegation instead.
    const passedOptions = toRDF.mock.calls[0]?.[1] as { documentLoader: (url: string) => Promise<unknown> };
    await expect(passedOptions.documentLoader('https://example.com')).resolves.toBe(remoteDoc);
    expect(documentLoader).toHaveBeenCalledWith('https://example.com');
  });

  it('handles non-Error thrown values', async () => {
    toRDF.mockRejectedValue('string error' as never);

    await expect(validateJsonLd({})).rejects.toMatchObject({
      code: 'jsonld.expansion-failed',
      received: 'string error',
    });
  });

  it('every concrete error extends JsonLdValidationError', async () => {
    await expect(validateJsonLd(null)).rejects.toBeInstanceOf(JsonLdValidationError);
    toRDF.mockRejectedValue(new Error('x') as never);
    await expect(validateJsonLd({})).rejects.toBeInstanceOf(JsonLdValidationError);
  });
});
