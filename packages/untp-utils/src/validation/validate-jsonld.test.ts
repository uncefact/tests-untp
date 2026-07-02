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

  it('passes the created document loader to toRDF', async () => {
    toRDF.mockResolvedValue([] as never);

    await validateJsonLd({ '@context': 'https://example.com' });

    expect(createJsonLdDocumentLoader).toHaveBeenCalledWith({ cache: undefined });
    expect(toRDF).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ documentLoader }));
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
