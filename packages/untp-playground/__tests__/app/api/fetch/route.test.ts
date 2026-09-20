/**
 * @jest-environment node
 */

jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers'),
  resolveDocument: jest.fn(),
}));

import { POST } from '@/app/api/fetch/route';
import { fetchErrorMessage } from '@/lib/fetchErrorMessages';
import {
  InvalidUrlError,
  PrivateAddressError,
  PrivateHostnameError,
  ResolutionEmptyError,
  ResolutionFailedError,
  UnsupportedSchemeError,
  UrlValidationError,
} from '@uncefact/untp-utils/node';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  ResolverError,
  ResolverHttpError,
  ResolverNetworkError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
  resolveDocument,
  type LoadResult,
} from '@uncefact/untp-utils/resolvers';

const mockedResolveDocument = resolveDocument as jest.MockedFunction<typeof resolveDocument>;

function loadFetchRoute(fetchAllowPrivateUrls: string | undefined): {
  post: typeof POST;
  resolveDocument: jest.MockedFunction<typeof resolveDocument>;
  UnsupportedSchemeError: typeof UnsupportedSchemeError;
} {
  const previousValue = process.env.FETCH_ALLOW_PRIVATE_URLS;
  if (fetchAllowPrivateUrls === undefined) delete process.env.FETCH_ALLOW_PRIVATE_URLS;
  else process.env.FETCH_ALLOW_PRIVATE_URLS = fetchAllowPrivateUrls;

  try {
    let post: typeof POST;
    let isolatedResolveDocument: jest.MockedFunction<typeof resolveDocument>;
    let isolatedUnsupportedSchemeError: typeof UnsupportedSchemeError;
    jest.isolateModules(() => {
      post = require('@/app/api/fetch/route').POST;
      isolatedResolveDocument = jest.requireMock('@uncefact/untp-utils/resolvers').resolveDocument;
      isolatedUnsupportedSchemeError = require('@uncefact/untp-utils/node').UnsupportedSchemeError;
    });
    return {
      post: post!,
      resolveDocument: isolatedResolveDocument!,
      UnsupportedSchemeError: isolatedUnsupportedSchemeError!,
    };
  } finally {
    if (previousValue === undefined) delete process.env.FETCH_ALLOW_PRIVATE_URLS;
    else process.env.FETCH_ALLOW_PRIVATE_URLS = previousValue;
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string): Request {
  return new Request('http://localhost/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function makeLoadResult(body: string | Uint8Array, overrides: Partial<LoadResult> = {}): Promise<LoadResult> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const bodyDigest = await MultibaseDigest.fromData(bytes, { algorithm: 'sha2-256', base: 'base58btc' });
  return {
    finalUrl: 'https://example.com/x.json',
    status: 200,
    body: bytes,
    bodyDigest,
    ...overrides,
  };
}

describe('POST /api/fetch', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    jest.clearAllMocks();
  });

  it('returns a JSON success with the normalised final URL and decoded body', async () => {
    const body = '{"hello":"world","plant":"🌱"}';
    mockedResolveDocument.mockResolvedValueOnce(
      await makeLoadResult(body, {
        finalUrl: 'HTTPS://EXAMPLE.COM:443/x',
        contentType: undefined,
      }),
    );

    const response = await POST(makeRequest({ url: 'https://example.com/x.json' }));
    const json = (await response.json()) as { ok: true; body: string; contentType: string | null; finalUrl: string };

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      body,
      contentType: null,
      finalUrl: 'https://example.com/x',
    });
    expect(JSON.parse(json.body)).toEqual({ hello: 'world', plant: '🌱' });
  });

  it('forwards the JSON resolver options and preserves a well-formed Content-Type', async () => {
    const { post, resolveDocument: isolatedResolveDocument } = loadFetchRoute(undefined);
    isolatedResolveDocument.mockResolvedValueOnce(
      await makeLoadResult('{}', { contentType: 'text/html; charset=utf-8' }),
    );

    const url = 'https://example.com/x.json';
    const response = await post(makeRequest({ url }));

    expect(response.status).toBe(200);
    expect(isolatedResolveDocument).toHaveBeenCalledWith(url, {
      allowedSchemes: ['https'],
      maxResponseBytes: 10 * 1_048_576,
      totalTimeoutMs: 10_000,
      maxRedirects: 3,
      headers: { Accept: 'application/json, application/ld+json, */*;q=0.1' },
    });
    expect(await response.json()).toMatchObject({ contentType: 'text/html; charset=utf-8' });
  });

  it('keeps an HTTP loopback URL blocked when private URL fetching is unset', async () => {
    const {
      post,
      resolveDocument: isolatedResolveDocument,
      UnsupportedSchemeError: isolatedUnsupportedSchemeError,
    } = loadFetchRoute(undefined);
    const url = 'http://127.0.0.1:4199/linksets/first.json';
    isolatedResolveDocument.mockRejectedValueOnce(new isolatedUnsupportedSchemeError('http', ['https']));

    const response = await post(makeRequest({ url }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Only https: URLs are allowed (got http:).',
    });
    expect(isolatedResolveDocument).toHaveBeenCalledWith(url, {
      allowedSchemes: ['https'],
      maxResponseBytes: 10 * 1_048_576,
      totalTimeoutMs: 10_000,
      maxRedirects: 3,
      headers: { Accept: 'application/json, application/ld+json, */*;q=0.1' },
    });
  });

  it('passes HTTP loopback URLs to the resolver when private URL fetching is enabled', async () => {
    const { post, resolveDocument: isolatedResolveDocument } = loadFetchRoute('true');
    const url = 'http://127.0.0.1:4199/linksets/first.json';
    isolatedResolveDocument.mockResolvedValueOnce(
      await makeLoadResult('{"linkset":[]}', { finalUrl: url, contentType: 'application/linkset+json' }),
    );

    const response = await post(makeRequest({ url, accept: 'linkset' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      body: '{"linkset":[]}',
      contentType: 'application/linkset+json',
      finalUrl: url,
    });
    expect(isolatedResolveDocument).toHaveBeenCalledWith(url, {
      allowedSchemes: ['http', 'https'],
      allowPrivateAddresses: true,
      maxResponseBytes: 10 * 1_048_576,
      totalTimeoutMs: 10_000,
      maxRedirects: 3,
      headers: { Accept: 'application/linkset+json, application/json;q=0.5, */*;q=0.1' },
    });
  });

  it('reports all allowed schemes when private URL fetching rejects an unsupported scheme', async () => {
    const {
      post,
      resolveDocument: isolatedResolveDocument,
      UnsupportedSchemeError: isolatedUnsupportedSchemeError,
    } = loadFetchRoute('true');
    const url = 'ftp://example.com/x';
    isolatedResolveDocument.mockRejectedValueOnce(new isolatedUnsupportedSchemeError('ftp', ['http', 'https']));

    const response = await post(makeRequest({ url }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Only http: or https: URLs are allowed (got ftp:).',
    });
  });

  it('forwards the link set Accept profile', async () => {
    const { post, resolveDocument: isolatedResolveDocument } = loadFetchRoute(undefined);
    isolatedResolveDocument.mockResolvedValueOnce(
      await makeLoadResult('{"linkset":[]}', { contentType: 'application/linkset+json' }),
    );

    const url = 'https://resolver.example.org/01/1?linkType=all';
    const response = await post(makeRequest({ url, accept: 'linkset' }));

    expect(response.status).toBe(200);
    expect(isolatedResolveDocument).toHaveBeenCalledWith(url, {
      allowedSchemes: ['https'],
      maxResponseBytes: 10 * 1_048_576,
      totalTimeoutMs: 10_000,
      maxRedirects: 3,
      headers: { Accept: 'application/linkset+json, application/json;q=0.5, */*;q=0.1' },
    });
  });

  it('passes through an empty body and a raw JWT body without parsing either', async () => {
    mockedResolveDocument.mockResolvedValueOnce(await makeLoadResult(''));
    const emptyResponse = await POST(makeRequest({ url: 'https://example.com/empty' }));
    expect(await emptyResponse.json()).toEqual({
      ok: true,
      body: '',
      contentType: null,
      finalUrl: 'https://example.com/x.json',
    });

    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ2ZXJpZmllciJ9.signature';
    mockedResolveDocument.mockResolvedValueOnce(await makeLoadResult(jwt));
    const jwtResponse = await POST(makeRequest({ url: 'https://example.com/jwt' }));
    const json = (await jwtResponse.json()) as { body: string };
    expect(json.body).toBe(jwt);
  });

  it('maps a 304 result to network without following another request', async () => {
    const finalUrl = 'https://example.com/unchanged';
    mockedResolveDocument.mockResolvedValueOnce(await makeLoadResult('', { status: 304, finalUrl }));

    const response = await POST(makeRequest({ url: finalUrl }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'network',
      message: `Upstream returned 304 for ${finalUrl}.`,
    });
    expect(mockedResolveDocument).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'invalid URL',
      new InvalidUrlError('ignored', new TypeError('Invalid URL')),
      'invalid-url',
      400,
      'Not a valid URL: https://requested.example/doc',
    ],
    [
      'unsupported scheme',
      new UnsupportedSchemeError('http', ['https']),
      'blocked',
      400,
      'Only https: URLs are allowed (got http:).',
    ],
    [
      'private hostname',
      new PrivateHostnameError('localhost'),
      'blocked',
      400,
      'Hostname localhost is in a blocked range.',
    ],
    [
      'private address',
      new PrivateAddressError('private.example', ['10.0.0.1']),
      'blocked',
      400,
      'Hostname private.example resolved to a private address.',
    ],
    [
      'DNS failure',
      new ResolutionFailedError('dns.example', new Error('EAI_AGAIN')),
      'network',
      502,
      'DNS resolution failed for dns.example.',
    ],
    [
      'empty DNS answer',
      new ResolutionEmptyError('empty.example'),
      'network',
      502,
      'DNS resolver returned no addresses for empty.example.',
    ],
    [
      'an unlisted future URL validation error',
      new UrlValidationError({ code: 'url.future', message: 'internal detail' }),
      'invalid-url',
      400,
      'Not a valid URL: https://requested.example/doc',
    ],
    [
      'upstream 404',
      new ResolverHttpError('https://requested.example/doc', 404),
      'not-found',
      404,
      'Upstream returned 404 for https://requested.example/doc.',
    ],
    [
      'upstream 403',
      new ResolverHttpError('https://requested.example/doc', 403),
      'network',
      502,
      'Upstream returned 403 for https://requested.example/doc.',
    ],
    [
      'too large',
      new ResolverTooLargeError('https://requested.example/doc', 999),
      'too-large',
      413,
      'Response exceeds 999 byte limit.',
    ],
    [
      'too many redirects',
      new ResolverTooManyRedirectsError('https://requested.example/doc', 7),
      'too-many-redirects',
      502,
      'Exceeded 7 redirect hops.',
    ],
    [
      'timeout',
      new ResolverTimedOutError('https://requested.example/doc', 12345),
      'timeout',
      504,
      'Request to https://requested.example/doc timed out after 12345ms (including redirects).',
    ],
    [
      'missing Location',
      new ResolverRedirectMissingLocationError('https://hop-b.example/doc', 302),
      'network',
      502,
      'Redirect from https://hop-b.example/doc had no parseable Location header.',
    ],
    [
      'transport error',
      new ResolverNetworkError('https://requested.example/doc', new Error('socket detail')),
      'network',
      502,
      'Could not fetch https://requested.example/doc.',
    ],
    [
      'other resolver error',
      new ResolverError({
        code: 'resolver.other',
        message: 'internal detail',
        received: 'secret',
        cause: new Error('cause detail'),
      }),
      'network',
      502,
      'Could not fetch https://requested.example/doc.',
    ],
    ['unknown error', new Error('socket detail'), 'network', 502, 'Unknown network error.'],
    ['a thrown non-Error value', 'socket detail', 'network', 502, 'Unknown network error.'],
  ])('maps %s to the closed response contract', async (_label, error, code, status, message) => {
    const inputUrl = 'https://requested.example/doc';
    mockedResolveDocument.mockRejectedValueOnce(error);

    const response = await POST(makeRequest({ url: inputUrl }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: code, message });
  });

  it('does not disclose private addresses or structured diagnostics in the response', async () => {
    const error = new PrivateAddressError('mixed.example', ['10.0.0.1', '93.184.216.34']);
    mockedResolveDocument.mockRejectedValueOnce(error);

    const response = await POST(makeRequest({ url: 'https://mixed.example/doc' }));
    const serialised = JSON.stringify(await response.json());

    expect(response.status).toBe(400);
    expect(serialised).not.toContain('10.0.0.1');
    expect(serialised).not.toContain('received');
    expect(serialised).not.toContain('cause');
    expect(serialised).not.toContain('url.private-address');
    expect(consoleError).toHaveBeenCalledWith(
      'Fetch route failed',
      expect.objectContaining({
        className: 'PrivateAddressError',
        code: 'url.private-address',
        resolvedAddresses: ['10.0.0.1', '93.184.216.34'],
        error,
      }),
    );
  });

  it('keeps upstream status in the message consumed by fetchErrorMessage', async () => {
    const error = new ResolverHttpError('https://requested.example/doc', 403);
    mockedResolveDocument.mockRejectedValueOnce(error);

    const response = await POST(makeRequest({ url: 'https://requested.example/doc' }));
    const json = (await response.json()) as { error: string; message: string };

    expect(fetchErrorMessage(json.error, json.message)).toBe(
      'The URL returned 403. Check the address and whether the document is publicly accessible.',
    );
  });

  it('names the failing redirect target, not the requested URL, in an upstream 404', async () => {
    mockedResolveDocument.mockRejectedValueOnce(new ResolverHttpError('https://b.example/doc', 404));

    const response = await POST(makeRequest({ url: 'https://a.example/doc' }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'not-found',
      message: 'Upstream returned 404 for https://b.example/doc.',
    });
  });

  it('logs a thrown non-Error value under its primitive type', async () => {
    mockedResolveDocument.mockRejectedValueOnce('socket detail');

    const response = await POST(makeRequest({ url: 'https://requested.example/doc' }));

    expect(response.status).toBe(502);
    expect(consoleError).toHaveBeenCalledWith(
      'Fetch route failed',
      expect.objectContaining({ className: 'string', error: 'socket detail' }),
    );
  });

  it('records a refused 304 server-side', async () => {
    const finalUrl = 'https://example.com/unchanged';
    mockedResolveDocument.mockResolvedValueOnce(await makeLoadResult('', { status: 304, finalUrl }));

    const response = await POST(makeRequest({ url: finalUrl }));

    expect(response.status).toBe(502);
    expect(consoleError).toHaveBeenCalledWith('Fetch route failed', {
      className: 'NotModified',
      status: 304,
      finalUrl,
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'text'],
    ['a number', 123],
    ['a missing URL', {}],
    ['an empty URL', { url: '' }],
    ['a non-string URL', { url: 123 }],
  ])('returns invalid-url for %s before resolving', async (_label, body) => {
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'invalid-url',
      message: 'Missing "url" string in body.',
    });
    expect(mockedResolveDocument).not.toHaveBeenCalled();
  });

  it('returns invalid-url for malformed JSON before resolving', async () => {
    const response = await POST(makeRawRequest('{'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'invalid-url',
      message: 'Request body must be JSON.',
    });
    expect(mockedResolveDocument).not.toHaveBeenCalled();
  });

  it.each([null, 123, ''])('rejects a non-string or empty Accept selector before resolving', async (accept) => {
    const response = await POST(makeRequest({ url: 'https://example.com/x.json', accept }));

    expect(response.status).toBe(400);
    expect((await response.json()) as { ok: boolean }).toMatchObject({ ok: false, error: 'invalid-url' });
    expect(mockedResolveDocument).not.toHaveBeenCalled();
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'rejects prototype-property selector %p before resolving',
    async (accept) => {
      const response = await POST(makeRequest({ url: 'https://example.com/x.json', accept }));

      expect(response.status).toBe(400);
      expect((await response.json()) as { ok: boolean }).toMatchObject({ ok: false, error: 'invalid-url' });
      expect(mockedResolveDocument).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown Accept selector before resolving', async () => {
    const response = await POST(makeRequest({ url: 'https://example.com/x.json', accept: 'text/anything' }));

    expect(response.status).toBe(400);
    expect((await response.json()) as { message: string }).toMatchObject({
      message: expect.stringContaining('accept'),
    });
    expect(mockedResolveDocument).not.toHaveBeenCalled();
  });
});
