/**
 * @jest-environment node
 */

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

jest.mock('../../../../../untp-utils/node_modules/undici', () => ({
  Agent: jest.fn().mockImplementation(() => {
    throw new Error('Unexpected undici Agent construction');
  }),
  fetch: jest.fn().mockImplementation(() => {
    throw new Error('Unexpected undici fetch call');
  }),
}));

import { POST } from '@/app/api/fetch/route';
import { lookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from '../../../../../untp-utils/node_modules/undici';

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockedAgent = Agent as jest.MockedClass<typeof Agent>;
const mockedUndiciFetch = undiciFetch as jest.MockedFunction<typeof undiciFetch>;

function makeRequest(url: string, accept?: string): Request {
  return new Request('http://localhost/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(accept === undefined ? { url } : { url, accept }),
  });
}

function allowTransport(): void {
  mockedAgent.mockImplementation(() => ({ close: jest.fn().mockResolvedValue(undefined) }) as never);
}

function makeResponse(body: string | Uint8Array | null, status = 200, headers?: HeadersInit): Response {
  const bodyInit = body instanceof Uint8Array ? (body as unknown as BodyInit) : body;
  return new Response(bodyInit, { status, headers });
}

describe('POST /api/fetch with the real resolver and guard', () => {
  let consoleError: jest.SpyInstance;
  // The undici instance mock below only traps the resolver's own transport. A
  // route that reached for the global fetch would bypass every guard while
  // leaving those traps untouched, so record and refuse global calls too. The
  // recording is asserted in afterEach, outside any production catch, because a
  // thrown refusal inside the route would otherwise be swallowed and mapped.
  const globalFetchCalls: unknown[][] = [];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    globalFetchCalls.length = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      globalFetchCalls.push(args);
      throw new Error('Unexpected global fetch call');
    }) as unknown as typeof globalThis.fetch;
    mockedLookup.mockReset();
    mockedAgent.mockReset().mockImplementation(() => {
      throw new Error('Unexpected undici Agent construction');
    });
    mockedUndiciFetch.mockReset().mockImplementation(() => {
      throw new Error('Unexpected undici fetch call');
    });
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    consoleError.mockRestore();
    expect(globalFetchCalls).toHaveLength(0);
  });

  it('blocks a private IPv4 literal before constructing an Agent or fetching', async () => {
    const response = await POST(makeRequest('https://192.168.1.1/x'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname 192.168.1.1 is in a blocked range.',
    });
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });

  it('blocks an IPv4-mapped private IPv6 literal before fetching', async () => {
    const response = await POST(makeRequest('https://[::ffff:127.0.0.1]/x'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname ::ffff:7f00:1 is in a blocked range.',
    });
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });

  it.each(['internal', 'local', 'lan', 'corp', 'home', 'intranet', 'private'])(
    'blocks a hostname with the .%s private suffix before fetching',
    async (suffix) => {
      const hostname = `service.${suffix}`;
      const response = await POST(makeRequest(`https://${hostname}/x`));
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json).toEqual({
        ok: false,
        error: 'blocked',
        message: `Hostname ${hostname} is in a blocked range.`,
      });
      expect(mockedLookup).not.toHaveBeenCalled();
      expect(mockedAgent).not.toHaveBeenCalled();
      expect(mockedUndiciFetch).not.toHaveBeenCalled();
    },
  );

  it('blocks a CGNAT literal before fetching', async () => {
    const response = await POST(makeRequest('https://100.64.0.1/x'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname 100.64.0.1 is in a blocked range.',
    });
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });

  it('blocks a hostname with a mixed public and private DNS answer without disclosing the address', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);

    const response = await POST(makeRequest('https://mixed.example/x'));
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname mixed.example resolved to a private address.',
    });
    expect(serialised).not.toContain('10.0.0.5');
    expect(serialised).not.toContain('received');
    expect(serialised).not.toContain('cause');
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Fetch route failed',
      expect.objectContaining({
        className: 'PrivateAddressError',
        code: 'url.private-address',
        resolvedAddresses: ['10.0.0.5'],
        error: expect.any(Error),
      }),
    );
  });

  it('returns the real resolver body in the existing wire shape and reaches the mocked transport', async () => {
    allowTransport();
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    mockedUndiciFetch.mockResolvedValueOnce(
      makeResponse('{"hello":"world","plant":"🌱"}', 200, { 'content-type': 'application/json' }),
    );

    const requestUrl = 'https://public.example/x';
    const response = await POST(makeRequest(requestUrl));
    const json = (await response.json()) as {
      ok: true;
      body: string;
      contentType: string | null;
      finalUrl: string;
    };

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      body: '{"hello":"world","plant":"🌱"}',
      contentType: 'application/json',
      finalUrl: requestUrl,
    });
    expect(JSON.parse(json.body)).toEqual({ hello: 'world', plant: '🌱' });
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
    const options = mockedUndiciFetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toEqual(
      expect.objectContaining({ Accept: 'application/json, application/ld+json, */*;q=0.1' }),
    );
  });

  it('blocks an http URL before DNS or transport', async () => {
    const response = await POST(makeRequest('http://public.example/x'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Only https: URLs are allowed (got http:).',
    });
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });

  it('blocks localhost before transport', async () => {
    const response = await POST(makeRequest('https://localhost/x'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname localhost is in a blocked range.',
    });
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });

  it('allows a public IPv4 literal through the mocked transport', async () => {
    allowTransport();
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse('ipv4'));

    const result = await POST(makeRequest('https://93.184.216.34/x'));

    expect(result.status).toBe(200);
    expect((await result.json()) as { body: string }).toMatchObject({ body: 'ipv4' });
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('allows a public IPv6 literal through the mocked transport', async () => {
    allowTransport();
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse('ipv6'));

    const result = await POST(makeRequest('https://[2001:4860:4860::8888]/x'));

    expect(result.status).toBe(200);
    expect((await result.json()) as { body: string }).toMatchObject({ body: 'ipv6' });
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('allows a public IPv4-mapped IPv6 literal through the mocked transport', async () => {
    allowTransport();
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse('mapped'));

    const result = await POST(makeRequest('https://[::ffff:93.184.216.34]/x'));

    expect(result.status).toBe(200);
    expect((await result.json()) as { body: string }).toMatchObject({ body: 'mapped' });
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('accepts a streamed body exactly at the 10 MiB cap', async () => {
    allowTransport();
    const body = new Uint8Array(10 * 1_048_576).fill(120);
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse(body));

    const result = await POST(makeRequest('https://93.184.216.34/at-cap'));
    const json = (await result.json()) as { ok: boolean; body: string };

    expect(result.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.body).toHaveLength(10 * 1_048_576);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a streamed body one byte over the 10 MiB cap', async () => {
    allowTransport();
    const body = new Uint8Array(10 * 1_048_576 + 1).fill(120);
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse(body));

    const result = await POST(makeRequest('https://93.184.216.34/over-cap'));

    expect(result.status).toBe(413);
    expect(await result.json()).toEqual({
      ok: false,
      error: 'too-large',
      message: 'Response exceeds 10485760 byte limit.',
    });
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('maps an empty DNS answer to network without attempting transport', async () => {
    mockedLookup.mockResolvedValueOnce([]);

    const response = await POST(makeRequest('https://empty.example/x'));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({
      ok: false,
      error: 'network',
      message: 'DNS resolver returned no addresses for empty.example.',
    });
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });

  it('preserves a valid HTML Content-Type from the resolver', async () => {
    allowTransport();
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    mockedUndiciFetch.mockResolvedValueOnce(
      makeResponse('<html />', 200, { 'content-type': 'text/html; charset=utf-8' }),
    );

    const result = await POST(makeRequest('https://html.example/x'));

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ contentType: 'text/html; charset=utf-8' });
  });

  it('returns null for a Content-Type form the resolver parser rejects', async () => {
    allowTransport();
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    mockedUndiciFetch.mockResolvedValueOnce(
      makeResponse('<html />', 200, { 'content-type': 'text/html;\tcharset=utf-8' }),
    );

    const result = await POST(makeRequest('https://html.example/x'));

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ contentType: null });
  });

  it('maps a 404 response and does not expose the resolver diagnostic', async () => {
    allowTransport();
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse('missing', 404));

    const requestUrl = 'https://93.184.216.34/missing';
    const result = await POST(makeRequest(requestUrl));
    const body = await result.json();

    expect(result.status).toBe(404);
    expect(body).toEqual({
      ok: false,
      error: 'not-found',
      message: `Upstream returned 404 for ${requestUrl}.`,
    });
    expect(JSON.stringify(body)).not.toContain('resolver.http-error');
  });

  it('maps a 304 response without following its Location', async () => {
    allowTransport();
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse(null, 304, { location: 'https://93.184.216.34/second' }));

    const requestUrl = 'https://93.184.216.34/first';
    const result = await POST(makeRequest(requestUrl));

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      ok: false,
      error: 'network',
      message: `Upstream returned 304 for ${requestUrl}.`,
    });
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('follows A to B to C with the selector Accept header on every request', async () => {
    allowTransport();
    mockedLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.36', family: 4 }]);
    mockedUndiciFetch
      .mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://b.example/doc' }))
      .mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://c.example/doc' }))
      .mockResolvedValueOnce(makeResponse('{"linkset":[]}', 200, { 'content-type': 'application/linkset+json' }));

    const result = await POST(makeRequest('https://a.example/doc', 'linkset'));
    const json = (await result.json()) as { body: string; finalUrl: string };

    expect(result.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      body: '{"linkset":[]}',
      contentType: 'application/linkset+json',
      finalUrl: 'https://c.example/doc',
    });
    expect(mockedUndiciFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://a.example/doc',
      'https://b.example/doc',
      'https://c.example/doc',
    ]);
    for (const [, options] of mockedUndiciFetch.mock.calls) {
      expect((options as RequestInit).headers).toEqual(
        expect.objectContaining({
          Accept: 'application/linkset+json, application/json;q=0.5, */*;q=0.1',
        }),
      );
    }
  });

  it('blocks a private redirect target before requesting that target', async () => {
    allowTransport();
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://b.internal/doc' }));

    const result = await POST(makeRequest('https://a.example/doc'));
    const body = await result.json();

    expect(result.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname b.internal is in a blocked range.',
    });
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect target resolving privately without exposing its address', async () => {
    allowTransport();
    mockedLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    mockedUndiciFetch.mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://b.example/doc' }));

    const result = await POST(makeRequest('https://a.example/doc'));
    const body = await result.json();

    expect(result.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: 'blocked',
      message: 'Hostname b.example resolved to a private address.',
    });
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('maps a redirect chain over the limit', async () => {
    allowTransport();
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockedUndiciFetch
      .mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://b.example/doc' }))
      .mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://c.example/doc' }))
      .mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://d.example/doc' }))
      .mockResolvedValueOnce(makeResponse(null, 302, { location: 'https://e.example/doc' }));

    const result = await POST(makeRequest('https://a.example/doc'));

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      ok: false,
      error: 'too-many-redirects',
      message: 'Exceeded 3 redirect hops.',
    });
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(4);
  });
});
