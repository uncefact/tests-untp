import { jest } from '@jest/globals';
import { createInMemoryTtlCache } from '../cache/in-memory-ttl-cache.js';
import type { LoadedRemoteDocument } from './jsonld-document-loader.js';

const resolveJsonDocument = jest.fn();

jest.unstable_mockModule('../resolvers/index.js', () => ({
  resolveJsonDocument,
}));

const { createJsonLdDocumentLoader } = await import('./jsonld-document-loader.js');

describe('createJsonLdDocumentLoader', () => {
  beforeEach(() => {
    resolveJsonDocument.mockReset();
  });

  it('resolves the URL through resolveJsonDocument and returns the RemoteDocument shape', async () => {
    resolveJsonDocument.mockResolvedValue({
      json: { '@context': { name: 'http://schema.org/name' } },
      finalUrl: 'https://ex.test/ctx',
    } as never);

    const result = await createJsonLdDocumentLoader()('https://ex.test/ctx');

    expect(result).toEqual({
      documentUrl: 'https://ex.test/ctx',
      document: { '@context': { name: 'http://schema.org/name' } },
    });
  });

  it('requests JSON-LD via the default Accept', async () => {
    resolveJsonDocument.mockResolvedValue({ json: {}, finalUrl: 'https://ex.test/ctx' } as never);

    await createJsonLdDocumentLoader()('https://ex.test/ctx');

    expect(resolveJsonDocument).toHaveBeenCalledWith(
      'https://ex.test/ctx',
      expect.objectContaining({ accept: expect.stringContaining('application/ld+json') }),
    );
  });

  it('lets the caller override the Accept header', async () => {
    resolveJsonDocument.mockResolvedValue({ json: {}, finalUrl: 'https://ex.test/ctx' } as never);

    await createJsonLdDocumentLoader({ accept: 'application/json' })('https://ex.test/ctx');

    expect(resolveJsonDocument).toHaveBeenCalledWith(
      'https://ex.test/ctx',
      expect.objectContaining({ accept: 'application/json' }),
    );
  });

  it('reports the post-redirect finalUrl as documentUrl', async () => {
    resolveJsonDocument.mockResolvedValue({ json: {}, finalUrl: 'https://ex.test/final' } as never);

    const result = await createJsonLdDocumentLoader()('https://ex.test/start');

    expect(result.documentUrl).toBe('https://ex.test/final');
  });

  it('forwards resolver options (e.g. allowedSchemes) to resolveJsonDocument', async () => {
    resolveJsonDocument.mockResolvedValue({ json: {}, finalUrl: 'https://ex.test/ctx' } as never);

    await createJsonLdDocumentLoader({ allowedSchemes: ['https'] })('https://ex.test/ctx');

    expect(resolveJsonDocument).toHaveBeenCalledWith(
      'https://ex.test/ctx',
      expect.objectContaining({ allowedSchemes: ['https'] }),
    );
  });

  it('propagates resolveJsonDocument rejections (SSRF guard, HTTP errors, bad JSON) unchanged', async () => {
    const guardError = Object.assign(new Error('private address'), { code: 'url.private-address' });
    resolveJsonDocument.mockRejectedValue(guardError as never);

    await expect(createJsonLdDocumentLoader()('http://127.0.0.1/ctx')).rejects.toBe(guardError);
  });

  describe('with a cache', () => {
    it('reuses a resolved context within the TTL instead of re-fetching', async () => {
      resolveJsonDocument.mockResolvedValue({ json: { '@context': {} }, finalUrl: 'https://ex.test/ctx' } as never);
      const cache = createInMemoryTtlCache<LoadedRemoteDocument>({ ttlMs: 60_000 });
      const load = createJsonLdDocumentLoader({ cache });

      await load('https://ex.test/ctx');
      await load('https://ex.test/ctx');

      expect(resolveJsonDocument).toHaveBeenCalledTimes(1);
    });

    it('does not cache a rejected resolution (re-checks next time)', async () => {
      const cache = createInMemoryTtlCache<LoadedRemoteDocument>({ ttlMs: 60_000 });
      const load = createJsonLdDocumentLoader({ cache });
      resolveJsonDocument.mockRejectedValueOnce(new Error('blocked') as never);

      await expect(load('https://ex.test/ctx')).rejects.toThrow('blocked');
      resolveJsonDocument.mockResolvedValueOnce({ json: {}, finalUrl: 'https://ex.test/ctx' } as never);
      await expect(load('https://ex.test/ctx')).resolves.toEqual({
        documentUrl: 'https://ex.test/ctx',
        document: {},
      });
      expect(resolveJsonDocument).toHaveBeenCalledTimes(2);
    });
  });
});
