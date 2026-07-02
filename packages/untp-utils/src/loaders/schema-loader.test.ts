import { jest } from '@jest/globals';
import { createInMemoryTtlCache } from '../cache/in-memory-ttl-cache.js';
import {
  SchemaLoaderError,
  SchemaLoaderHttpError,
  SchemaLoaderInvalidJsonError,
  SchemaLoaderNetworkError,
} from './errors.js';
import { createSchemaLoader } from './schema-loader.js';

const SCHEMA_URL = 'https://example.com/schema.json';

type FetchFn = typeof globalThis.fetch;

describe('createSchemaLoader', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as FetchFn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk(body: object): void {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as never);
  }

  describe('uncached (no cache supplied)', () => {
    it('resolves with the parsed schema body', async () => {
      mockOk({ $schema: 'foo' });
      const loader = createSchemaLoader();
      await expect(loader.load(SCHEMA_URL)).resolves.toEqual({ $schema: 'foo' });
    });

    it('fetches afresh on every call', async () => {
      mockOk({ $schema: 'foo' });
      const loader = createSchemaLoader();
      await loader.load(SCHEMA_URL);
      await loader.load(SCHEMA_URL);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('cached (cache supplied)', () => {
    it('caches subsequent loads within the TTL', async () => {
      mockOk({ $schema: 'foo' });
      const cache = createInMemoryTtlCache<object>({ ttlMs: 60_000 });
      const loader = createSchemaLoader(cache);

      await loader.load(SCHEMA_URL);
      await loader.load(SCHEMA_URL);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent loads for the same URL via the cache', async () => {
      let resolveFetch!: (r: object) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((r) => {
            resolveFetch = r;
          }) as never,
      );
      const cache = createInMemoryTtlCache<object>({ ttlMs: 60_000 });
      const loader = createSchemaLoader(cache);

      const a = loader.load(SCHEMA_URL);
      const b = loader.load(SCHEMA_URL);
      resolveFetch({ ok: true, status: 200, json: async () => ({ $schema: 'foo' }) });
      await expect(a).resolves.toEqual({ $schema: 'foo' });
      await expect(b).resolves.toEqual({ $schema: 'foo' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('two loaders with separate caches do not share state', async () => {
      mockOk({ $schema: 'foo' });
      const a = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));
      const b = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));

      await a.load(SCHEMA_URL);
      await b.load(SCHEMA_URL);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('clearing the cache forces the next load to re-fetch', async () => {
      mockOk({ $schema: 'foo' });
      const cache = createInMemoryTtlCache<object>({ ttlMs: 60_000 });
      const loader = createSchemaLoader(cache);

      await loader.load(SCHEMA_URL);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await cache.clear();
      await loader.load(SCHEMA_URL);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('throws (applies to both cached and uncached paths)', () => {
    it('throws SchemaLoaderNetworkError when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused') as never);
      const loader = createSchemaLoader();
      const error = (await loader.load(SCHEMA_URL).catch((e: unknown) => e)) as SchemaLoaderNetworkError;
      expect(error).toBeInstanceOf(SchemaLoaderNetworkError);
      expect(error.received).toBe('connection refused');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('throws SchemaLoaderHttpError on a non-2xx response with the status attached', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 } as never);
      const loader = createSchemaLoader();
      const error = (await loader.load(SCHEMA_URL).catch((e: unknown) => e)) as SchemaLoaderHttpError;
      expect(error).toBeInstanceOf(SchemaLoaderHttpError);
      expect(error.status).toBe(503);
    });

    it('throws SchemaLoaderInvalidJsonError when the body is not parseable', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token');
        },
      } as never);
      const loader = createSchemaLoader();
      const error = (await loader.load(SCHEMA_URL).catch((e: unknown) => e)) as SchemaLoaderInvalidJsonError;
      expect(error).toBeInstanceOf(SchemaLoaderInvalidJsonError);
      expect(error.received).toBe('Unexpected token');
    });

    it('does not cache failed loads (retries on next call)', async () => {
      const cache = createInMemoryTtlCache<object>({ ttlMs: 60_000 });
      const loader = createSchemaLoader(cache);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderHttpError);
      mockOk({ $schema: 'foo' });
      await expect(loader.load(SCHEMA_URL)).resolves.toEqual({ $schema: 'foo' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('every concrete error extends SchemaLoaderError', async () => {
      const loader = createSchemaLoader();
      fetchMock.mockRejectedValueOnce(new Error('fail') as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderError);

      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderError);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      } as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderError);
    });
  });
});
