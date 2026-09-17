/**
 * @jest-environment node
 */
const mockResolveJsonDocument = jest.fn();

jest.mock('@uncefact/untp-utils/resolvers', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/resolvers');
  return { ...actual, resolveJsonDocument: (...args: unknown[]) => mockResolveJsonDocument(...args) };
});

jest.mock('@uncefact/untp-utils/loaders', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/loaders');
  return { ...actual, createSchemaLoader: jest.fn(actual.createSchemaLoader) };
});

jest.mock('@uncefact/untp-utils/cache', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/cache');
  return { ...actual, createInMemoryTtlCache: jest.fn(actual.createInMemoryTtlCache) };
});

import { findBundledArtefact } from '@uncefact/untp-utils/bundled-artefacts';
import { ResolverHttpError, ResolverInvalidJsonError, ResolverNetworkError } from '@uncefact/untp-utils/resolvers';
import { GET } from '@/app/api/schema/route';
import { validateSchemaDocument } from '@/lib/schemaValidation';

const SCHEMA_URL = 'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json';
const FETCHED_SCHEMA_URL = 'https://schemas.example.org/fetched-schema.json';

function makeRequest(url?: string): Request {
  const target = new URL('http://localhost/api/schema');
  if (url !== undefined) target.searchParams.set('url', url);
  return new Request(target);
}

describe('GET /api/schema', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    mockResolveJsonDocument.mockReset();
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
    mockResolveJsonDocument.mockResolvedValueOnce({
      json: { $id: FETCHED_SCHEMA_URL, type: 'object' },
      finalUrl: FETCHED_SCHEMA_URL,
    });
    const response = await GET(makeRequest(FETCHED_SCHEMA_URL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ $id: FETCHED_SCHEMA_URL, type: 'object' });
    expect(mockResolveJsonDocument).toHaveBeenCalledWith(
      FETCHED_SCHEMA_URL,
      expect.objectContaining({ accept: expect.any(String), totalTimeoutMs: 10_000 }),
    );
  });

  it('serves the bundled schema after an upstream 404 without adding a client failure', async () => {
    const bundledSchema = await findBundledArtefact(SCHEMA_URL);
    if (bundledSchema === undefined) throw new Error(`The test bundle does not carry ${SCHEMA_URL}.`);
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverHttpError(SCHEMA_URL, 404));

    const response = await GET(makeRequest(SCHEMA_URL));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(bundledSchema);

    const result = validateSchemaDocument(
      bundledSchema,
      {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/0.7.0/context/'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        id: 'https://example.com/dpp/1',
        issuer: { id: 'did:web:example.com', name: 'Example' },
        validFrom: '2024-01-01T00:00:00Z',
        name: 'Example',
        credentialSubject: {
          id: 'https://example.com/product/1',
          name: 'Widget',
          idScheme: { id: 'https://id.example/scheme', name: 'Example scheme' },
          idGranularity: 'batch',
          productCategory: [{ code: '123', name: 'Widget', schemeId: 'https://scheme.example', schemeName: 'Example' }],
          producedAtFacility: { id: 'https://example.com/facility/1', name: 'Facility' },
          countryOfProduction: { countryCode: 'AU' },
        },
      },
      SCHEMA_URL,
      'credential',
    );
    expect(result).toMatchObject({ valid: true });
    expect(result.failure).toBeUndefined();
  });

  it.each([
    ['no url', undefined, 'No schema URL provided'],
    ['an unparseable url', 'not a url', 'Invalid schema URL'],
    ['a plain http url', 'http://untp.unece.org/schema.json', 'Schema URL must use https'],
  ])('rejects %s before touching the loader', async (_label, url, message) => {
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(mockResolveJsonDocument).not.toHaveBeenCalled();
  });

  it('hands any public https host to the loader rather than keeping an allowlist', async () => {
    mockResolveJsonDocument.mockResolvedValue({ json: { type: 'object' }, finalUrl: SCHEMA_URL });
    for (const url of [
      'https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.1-beta1.json',
      'https://schemas.example.org/some-future-extension.json',
    ]) {
      const response = await GET(makeRequest(url));
      expect(response.status).toBe(200);
      expect(mockResolveJsonDocument).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ accept: expect.any(String), totalTimeoutMs: 10_000 }),
      );
    }
  });

  it('reports an upstream HTTP failure as 502 naming the status', async () => {
    const url = 'https://schemas.example.org/upstream-status.json';
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverHttpError(url, 404));
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Schema host returned status 404',
      code: 'upstream-status',
      upstreamStatus: 404,
    });
  });

  it('reports an unparseable upstream body as 502', async () => {
    const url = 'https://schemas.example.org/invalid-json.json';
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverInvalidJsonError(url, new SyntaxError('bad json')));
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Schema host returned a body that is not valid JSON',
      code: 'invalid-json',
    });
  });

  it('reports a failed load as 502 without the transport detail', async () => {
    const url = 'https://schemas.example.org/network-error.json';
    const cause = new Error('getaddrinfo ENOTFOUND');
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverNetworkError(url, cause));
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The schema could not be loaded from its host',
      code: 'unreachable',
    });
    expect(consoleError).toHaveBeenCalledWith('Schema fetch failed', {
      url,
      code: 'schema-loader.network-error',
      causeCode: undefined,
      cause,
    });
  });

  it('logs the guard rejection code when the loader refused a private address', async () => {
    const url = 'https://schemas.example.org/private-address.json';
    const guardRejection = Object.assign(new Error('resolves to a private address'), { code: 'url.private-address' });
    mockResolveJsonDocument.mockRejectedValueOnce(new ResolverNetworkError(url, guardRejection));
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The schema could not be loaded from its host',
      code: 'unreachable',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Schema fetch failed',
      expect.objectContaining({ url, causeCode: 'url.private-address' }),
    );
  });

  it('reports an untyped resolver failure as an unreachable upstream load', async () => {
    const url = 'https://schemas.example.org/unexpected.json';
    const error = new Error('boom');
    mockResolveJsonDocument.mockRejectedValueOnce(error);
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The schema could not be loaded from its host',
      code: 'unreachable',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Schema fetch failed',
      expect.objectContaining({ url, code: 'schema-loader.network-error' }),
    );
  });
});
