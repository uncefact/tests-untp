/**
 * @jest-environment node
 */
import type { SchemaLoader } from '@uncefact/untp-utils/loaders';

const mockLoad = jest.fn<Promise<object>, [string]>();

jest.mock('@uncefact/untp-utils/loaders', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/loaders');
  return {
    ...actual,
    createSchemaLoader: jest.fn((): SchemaLoader => ({ load: (url) => mockLoad(url) })),
  };
});

jest.mock('@uncefact/untp-utils/cache', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/cache');
  return { ...actual, createInMemoryTtlCache: jest.fn(actual.createInMemoryTtlCache) };
});

import {
  SchemaLoaderHttpError,
  SchemaLoaderInvalidJsonError,
  SchemaLoaderNetworkError,
} from '@uncefact/untp-utils/loaders';
import { GET } from '@/app/api/schema/route';

const SCHEMA_URL = 'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json';

function makeRequest(url?: string): Request {
  const target = new URL('http://localhost/api/schema');
  if (url !== undefined) target.searchParams.set('url', url);
  return new Request(target);
}

describe('GET /api/schema', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    mockLoad.mockReset();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('builds one loader over a bounded TTL cache when the module loads', () => {
    jest.isolateModules(() => {
      const { createInMemoryTtlCache: createCache } = jest.requireMock('@uncefact/untp-utils/cache');
      const { createSchemaLoader: createLoader } = jest.requireMock('@uncefact/untp-utils/loaders');
      createCache.mockClear();
      createLoader.mockClear();
      jest.requireActual('@/app/api/schema/route');
      expect(createCache).toHaveBeenCalledTimes(1);
      expect(createCache).toHaveBeenCalledWith({ ttlMs: 60 * 60 * 1000, maxEntries: 200 });
      expect(createLoader).toHaveBeenCalledTimes(1);
      expect(createLoader).toHaveBeenCalledWith(
        expect.objectContaining({ get: expect.any(Function) }),
        expect.objectContaining({ onBundledFallback: expect.any(Function) }),
      );
    });
  });

  it('logs a warning naming the URL and cause code when the bundled copy stands in', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.isolateModules(() => {
      const { createSchemaLoader: createLoader } = jest.requireMock('@uncefact/untp-utils/loaders');
      createLoader.mockClear();
      jest.requireActual('@/app/api/schema/route');
      const { onBundledFallback } = createLoader.mock.calls[0][1];
      onBundledFallback({
        url: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.7.0.json',
        cause: Object.assign(new Error('HTTP 503'), { code: 'resolver.http-error' }),
      });
    });
    expect(warn).toHaveBeenCalledWith('Served the bundled copy of a schema because its fetch failed', {
      url: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.7.0.json',
      code: 'resolver.http-error',
    });
    warn.mockRestore();
  });

  it('returns the schema the loader fetched', async () => {
    mockLoad.mockResolvedValueOnce({ $id: SCHEMA_URL, type: 'object' });
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ $id: SCHEMA_URL, type: 'object' });
    expect(mockLoad).toHaveBeenCalledWith(SCHEMA_URL);
  });

  it.each([
    ['no url', undefined, 'No schema URL provided'],
    ['an unparseable url', 'not a url', 'Invalid schema URL'],
    ['a plain http url', 'http://untp.unece.org/schema.json', 'Schema URL must use https'],
  ])('rejects %s before touching the loader', async (_label, url, message) => {
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('hands any public https host to the loader rather than keeping an allowlist', async () => {
    mockLoad.mockResolvedValue({ type: 'object' });
    for (const url of [
      'https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.1-beta1.json',
      'https://schemas.example.org/some-future-extension.json',
    ]) {
      const response = await GET(makeRequest(url));
      expect(response.status).toBe(200);
      expect(mockLoad).toHaveBeenCalledWith(url);
    }
  });

  it('reports an upstream HTTP failure as 502 naming the status', async () => {
    mockLoad.mockRejectedValueOnce(new SchemaLoaderHttpError(SCHEMA_URL, 404));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Schema host returned status 404',
      code: 'upstream-status',
      upstreamStatus: 404,
    });
  });

  it('reports an unparseable upstream body as 502', async () => {
    mockLoad.mockRejectedValueOnce(new SchemaLoaderInvalidJsonError(SCHEMA_URL, new SyntaxError('bad json')));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Schema host returned a body that is not valid JSON',
      code: 'invalid-json',
    });
  });

  it('reports a failed load as 502 without the transport detail', async () => {
    const cause = new Error('getaddrinfo ENOTFOUND');
    mockLoad.mockRejectedValueOnce(new SchemaLoaderNetworkError(SCHEMA_URL, cause));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The schema could not be loaded from its host',
      code: 'unreachable',
    });
    expect(consoleError).toHaveBeenCalledWith('Schema fetch failed', {
      url: SCHEMA_URL,
      code: 'schema-loader.network-error',
      causeCode: undefined,
      cause,
    });
  });

  it('logs the guard rejection code when the loader refused a private address', async () => {
    const guardRejection = Object.assign(new Error('resolves to a private address'), { code: 'url.private-address' });
    mockLoad.mockRejectedValueOnce(new SchemaLoaderNetworkError(SCHEMA_URL, guardRejection));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The schema could not be loaded from its host',
      code: 'unreachable',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Schema fetch failed',
      expect.objectContaining({ url: SCHEMA_URL, causeCode: 'url.private-address' }),
    );
  });

  it('reports any other failure as 500', async () => {
    const error = new Error('boom');
    mockLoad.mockRejectedValueOnce(error);
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fetch schema' });
    expect(consoleError).toHaveBeenCalledWith('Unexpected schema loader failure', { url: SCHEMA_URL, error });
  });
});
