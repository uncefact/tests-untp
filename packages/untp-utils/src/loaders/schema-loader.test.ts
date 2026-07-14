import { jest } from '@jest/globals';
import { createInMemoryTtlCache } from '../cache/in-memory-ttl-cache.js';
import {
  ResolverHttpError,
  ResolverInvalidJsonError,
  ResolverNetworkError,
  ResolverTimedOutError,
} from '../resolvers/errors.js';
import { PrivateHostnameError } from '../node/errors.js';
import {
  SchemaLoaderError,
  SchemaLoaderHttpError,
  SchemaLoaderInvalidJsonError,
  SchemaLoaderNetworkError,
} from './errors.js';

const resolveJsonDocument = jest.fn();

// Mock the resolver entry point but keep the real error classes so the
// loader's `instanceof` mapping continues to work.
jest.unstable_mockModule('../resolvers/index.js', () => ({
  resolveJsonDocument,
  ResolverHttpError,
  ResolverInvalidJsonError,
}));

const { createSchemaLoader } = await import('./schema-loader.js');

const SCHEMA_URL = 'https://example.com/schema.json';

function mockOk(body: object): void {
  resolveJsonDocument.mockResolvedValue({ json: body, finalUrl: SCHEMA_URL } as never);
}

describe('createSchemaLoader', () => {
  beforeEach(() => {
    resolveJsonDocument.mockReset();
  });

  describe('uncached (no cache supplied)', () => {
    it('resolves with the parsed schema body', async () => {
      mockOk({ $schema: 'foo' });
      await expect(createSchemaLoader().load(SCHEMA_URL)).resolves.toEqual({ $schema: 'foo' });
    });

    it('fetches the URL through the guarded resolver', async () => {
      mockOk({ $schema: 'foo' });
      await createSchemaLoader().load(SCHEMA_URL);
      expect(resolveJsonDocument).toHaveBeenCalledWith(
        SCHEMA_URL,
        expect.objectContaining({
          accept: expect.stringContaining('application/schema+json'),
          totalTimeoutMs: 10_000,
        }),
      );
    });

    it('fetches afresh on every call', async () => {
      mockOk({ $schema: 'foo' });
      const loader = createSchemaLoader();
      await loader.load(SCHEMA_URL);
      await loader.load(SCHEMA_URL);
      expect(resolveJsonDocument).toHaveBeenCalledTimes(2);
    });

    it('types load() by the caller-declared schema shape', async () => {
      mockOk({ $id: SCHEMA_URL });
      const loader = createSchemaLoader<{ $id: string }>();
      const schema = await loader.load(SCHEMA_URL);
      // The generic is a compile-time assertion only; the value is the parsed JSON.
      expect(schema.$id).toBe(SCHEMA_URL);
    });
  });

  describe('cached (cache supplied)', () => {
    it('caches subsequent loads within the TTL', async () => {
      mockOk({ $schema: 'foo' });
      const loader = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));
      await loader.load(SCHEMA_URL);
      await loader.load(SCHEMA_URL);
      expect(resolveJsonDocument).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent loads for the same URL via the cache', async () => {
      let resolve!: (r: { json: object; finalUrl: string }) => void;
      resolveJsonDocument.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r as (r: { json: object; finalUrl: string }) => void;
          }) as never,
      );
      const loader = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));

      const a = loader.load(SCHEMA_URL);
      const b = loader.load(SCHEMA_URL);
      // The loader imports the guarded resolver lazily, so the mocked fetch
      // starts a tick after load(); wait for it before releasing the promise.
      while (resolveJsonDocument.mock.calls.length === 0) {
        await new Promise((r) => setImmediate(r));
      }
      resolve({ json: { $schema: 'foo' }, finalUrl: SCHEMA_URL });
      await expect(a).resolves.toEqual({ $schema: 'foo' });
      await expect(b).resolves.toEqual({ $schema: 'foo' });
      expect(resolveJsonDocument).toHaveBeenCalledTimes(1);
    });

    it('two loaders with separate caches do not share state', async () => {
      mockOk({ $schema: 'foo' });
      const a = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));
      const b = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));
      await a.load(SCHEMA_URL);
      await b.load(SCHEMA_URL);
      expect(resolveJsonDocument).toHaveBeenCalledTimes(2);
    });

    it('clearing the cache forces the next load to re-fetch', async () => {
      mockOk({ $schema: 'foo' });
      const cache = createInMemoryTtlCache<object>({ ttlMs: 60_000 });
      const loader = createSchemaLoader(cache);
      await loader.load(SCHEMA_URL);
      expect(resolveJsonDocument).toHaveBeenCalledTimes(1);
      await cache.clear();
      await loader.load(SCHEMA_URL);
      expect(resolveJsonDocument).toHaveBeenCalledTimes(2);
    });
  });

  describe('error mapping (applies to both cached and uncached paths)', () => {
    it('maps a resolver HTTP error to SchemaLoaderHttpError with the status', async () => {
      resolveJsonDocument.mockRejectedValue(new ResolverHttpError(SCHEMA_URL, 503) as never);
      const error = (await createSchemaLoader()
        .load(SCHEMA_URL)
        .catch((e: unknown) => e)) as SchemaLoaderHttpError;
      expect(error).toBeInstanceOf(SchemaLoaderHttpError);
      expect(error.status).toBe(503);
    });

    it('maps a resolver invalid-JSON error to SchemaLoaderInvalidJsonError with the parser diagnostic', async () => {
      const parserError = new Error('Unexpected token < in JSON at position 0');
      resolveJsonDocument.mockRejectedValue(new ResolverInvalidJsonError(SCHEMA_URL, parserError) as never);
      const error = (await createSchemaLoader()
        .load(SCHEMA_URL)
        .catch((e: unknown) => e)) as SchemaLoaderInvalidJsonError;
      expect(error).toBeInstanceOf(SchemaLoaderInvalidJsonError);
      expect(error.received).toBe('Unexpected token < in JSON at position 0');
      expect(error.cause).toBe(parserError);
    });

    it('maps a resolver network error to SchemaLoaderNetworkError with the transport diagnostic', async () => {
      const transportError = new Error('connection refused');
      resolveJsonDocument.mockRejectedValue(new ResolverNetworkError(SCHEMA_URL, transportError) as never);
      const error = (await createSchemaLoader()
        .load(SCHEMA_URL)
        .catch((e: unknown) => e)) as SchemaLoaderNetworkError;
      expect(error).toBeInstanceOf(SchemaLoaderNetworkError);
      expect(error.received).toBe('connection refused');
      expect(error.cause).toBe(transportError);
    });

    it('keeps the typed resolver error as the cause for new failure modes (timeout)', async () => {
      const cause = new ResolverTimedOutError(SCHEMA_URL, 10_000, new Error('aborted'));
      resolveJsonDocument.mockRejectedValue(cause as never);
      const error = (await createSchemaLoader()
        .load(SCHEMA_URL)
        .catch((e: unknown) => e)) as SchemaLoaderNetworkError;
      expect(error).toBeInstanceOf(SchemaLoaderNetworkError);
      expect(error.cause).toBe(cause);
    });

    it('maps an SSRF / URL-validation rejection to SchemaLoaderNetworkError, preserving the cause', async () => {
      const cause = new PrivateHostnameError('127.0.0.1');
      resolveJsonDocument.mockRejectedValue(cause as never);
      const error = (await createSchemaLoader()
        .load(SCHEMA_URL)
        .catch((e: unknown) => e)) as SchemaLoaderNetworkError;
      expect(error).toBeInstanceOf(SchemaLoaderNetworkError);
      expect(error.cause).toBe(cause);
    });

    it('does not cache failed loads (retries on next call)', async () => {
      const loader = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: 60_000 }));
      resolveJsonDocument.mockRejectedValueOnce(new ResolverHttpError(SCHEMA_URL, 503) as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderHttpError);
      mockOk({ $schema: 'foo' });
      await expect(loader.load(SCHEMA_URL)).resolves.toEqual({ $schema: 'foo' });
      expect(resolveJsonDocument).toHaveBeenCalledTimes(2);
    });

    it('every concrete error extends SchemaLoaderError', async () => {
      const loader = createSchemaLoader();
      resolveJsonDocument.mockRejectedValueOnce(new ResolverNetworkError(SCHEMA_URL, new Error('x')) as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderError);
      resolveJsonDocument.mockRejectedValueOnce(new ResolverHttpError(SCHEMA_URL, 404) as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderError);
      resolveJsonDocument.mockRejectedValueOnce(new ResolverInvalidJsonError(SCHEMA_URL, new Error('x')) as never);
      await expect(loader.load(SCHEMA_URL)).rejects.toBeInstanceOf(SchemaLoaderError);
    });
  });
});
