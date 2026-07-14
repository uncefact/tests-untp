import { jest } from '@jest/globals';
import { createInMemoryTtlCache } from '../cache/in-memory-ttl-cache.js';
import type { LoadedRemoteDocument } from '../loaders/jsonld-document-loader.js';

const resolveJsonDocument = jest.fn();

// Mock only the resolver boundary: real jsonld, real document loader, real
// cache. This pins the seam validateJsonLd's contextCache option promises:
// the cache outlives the per-call loader instance, so separate validateJsonLd
// calls sharing one cache resolve each remote @context once.
jest.unstable_mockModule('../resolvers/index.js', () => ({ resolveJsonDocument }));

const { validateJsonLd } = await import('./validate-jsonld.js');

const CONTEXT_URL = 'https://example.com/context';
const DOCUMENT = { '@context': CONTEXT_URL, name: 'Acme' };

describe('validateJsonLd contextCache reuse across calls', () => {
  beforeEach(() => {
    resolveJsonDocument.mockReset();
    resolveJsonDocument.mockResolvedValue({
      json: { '@context': { name: 'http://schema.org/name' } },
      finalUrl: CONTEXT_URL,
    } as never);
  });

  it('resolves a remote @context once across separate calls sharing one cache', async () => {
    const contextCache = createInMemoryTtlCache<LoadedRemoteDocument>({ ttlMs: 60_000 });
    await expect(validateJsonLd(DOCUMENT, { contextCache })).resolves.toBeUndefined();
    await expect(validateJsonLd(DOCUMENT, { contextCache })).resolves.toBeUndefined();
    expect(resolveJsonDocument).toHaveBeenCalledTimes(1);
  });

  it('re-resolves the remote @context per call without a shared cache', async () => {
    await expect(validateJsonLd(DOCUMENT)).resolves.toBeUndefined();
    await expect(validateJsonLd(DOCUMENT)).resolves.toBeUndefined();
    expect(resolveJsonDocument).toHaveBeenCalledTimes(2);
  });
});
