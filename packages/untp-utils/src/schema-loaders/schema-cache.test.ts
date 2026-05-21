import { jest } from '@jest/globals';
import { SchemaLoaderCode } from '../validation/codes.js';
import { clearSchemaCache, fetchSchema, getSchemaCache } from './schema-cache.js';

const SCHEMA_URL = 'https://example.com/schema.json';

type FetchFn = typeof globalThis.fetch;

describe('schema-cache', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    clearSchemaCache();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as FetchFn;
    delete process.env.SCHEMA_CACHE_TTL_MS;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOkResponse(body: object): void {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as never);
  }

  describe('happy path', () => {
    it('returns the fetched schema as the outcome value', async () => {
      mockOkResponse({ $schema: 'foo' });

      const outcome = await fetchSchema(SCHEMA_URL);

      expect(outcome.errors).toEqual([]);
      expect(outcome.value).toEqual({ $schema: 'foo' });
    });

    it('caches subsequent fetches within the TTL', async () => {
      mockOkResponse({ $schema: 'foo' });

      await fetchSchema(SCHEMA_URL);
      await fetchSchema(SCHEMA_URL);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('errors', () => {
    it('emits a network-error when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused') as never);

      const outcome = await fetchSchema(SCHEMA_URL);

      expect(outcome.value).toBeUndefined();
      expect(outcome.errors).toEqual([
        expect.objectContaining({
          code: SchemaLoaderCode.NetworkError,
          received: 'connection refused',
        }),
      ]);
    });

    it('emits an http-error on a non-2xx response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 } as never);

      const outcome = await fetchSchema(SCHEMA_URL);

      expect(outcome.value).toBeUndefined();
      expect(outcome.errors).toEqual([
        expect.objectContaining({
          code: SchemaLoaderCode.HttpError,
          received: 503,
        }),
      ]);
    });

    it('emits an invalid-json error when the body is not parseable', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token');
        },
      } as never);

      const outcome = await fetchSchema(SCHEMA_URL);

      expect(outcome.value).toBeUndefined();
      expect(outcome.errors).toEqual([
        expect.objectContaining({
          code: SchemaLoaderCode.InvalidJson,
          received: 'Unexpected token',
        }),
      ]);
    });
  });

  describe('cache helpers', () => {
    it('clearSchemaCache empties the cache', async () => {
      mockOkResponse({ $schema: 'foo' });
      await fetchSchema(SCHEMA_URL);
      expect(getSchemaCache().size).toBe(1);

      clearSchemaCache();

      expect(getSchemaCache().size).toBe(0);
    });
  });
});
