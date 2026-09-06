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
const load = mockLoad;

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
  beforeEach(() => {
    load.mockReset();
  });

  it('returns the schema the loader fetched', async () => {
    load.mockResolvedValueOnce({ $id: SCHEMA_URL, type: 'object' });
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ $id: SCHEMA_URL, type: 'object' });
    expect(load).toHaveBeenCalledWith(SCHEMA_URL);
  });

  it.each([
    ['no url', undefined, 'No schema URL provided'],
    ['an unparseable url', 'not a url', 'Invalid schema URL'],
    ['a plain http url', 'http://untp.unece.org/schema.json', 'Schema URL must use https'],
    ['a host off the allowlist', 'https://evil.example/schema.json', 'Schema URL host is not on the allowlist'],
  ])('rejects %s before touching the loader', async (_label, url, message) => {
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(load).not.toHaveBeenCalled();
  });

  it('allows the DLP extension schema host', async () => {
    load.mockResolvedValueOnce({ type: 'object' });
    const url = 'https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.1-beta1.json';
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(url);
  });

  it('reports an upstream HTTP failure as 502 naming the status', async () => {
    load.mockRejectedValueOnce(new SchemaLoaderHttpError(SCHEMA_URL, 404));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Schema host returned status 404', upstreamStatus: 404 });
  });

  it('reports an unparseable upstream body as 502', async () => {
    load.mockRejectedValueOnce(new SchemaLoaderInvalidJsonError(SCHEMA_URL, new SyntaxError('bad json')));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Schema host returned a body that is not valid JSON' });
  });

  it('reports an unreachable schema host as 502 without the transport detail', async () => {
    load.mockRejectedValueOnce(new SchemaLoaderNetworkError(SCHEMA_URL, new Error('getaddrinfo ENOTFOUND')));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Schema host could not be reached' });
  });

  it('reports any other failure as 500', async () => {
    load.mockRejectedValueOnce(new Error('boom'));
    const response = await GET(makeRequest(SCHEMA_URL));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fetch schema' });
  });
});
