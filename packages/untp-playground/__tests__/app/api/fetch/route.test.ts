/**
 * @jest-environment node
 */
import { POST } from '@/app/api/fetch/route';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

import { lookup } from 'node:dns/promises';

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/fetch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('rejects non-https URLs', async () => {
    const response = await POST(makeRequest({ url: 'http://example.com/x.json' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json).toEqual({ ok: false, error: 'blocked', message: expect.stringContaining('https:') });
  });

  it('rejects localhost', async () => {
    const response = await POST(makeRequest({ url: 'https://localhost/x.json' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('blocked');
  });

  it('rejects hostnames that resolve to private IPs', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    const response = await POST(makeRequest({ url: 'https://internal.example.com/x.json' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('blocked');
    expect(json.message).toContain('10.0.0.1');
  });

  it('rejects literal private IPs', async () => {
    const response = await POST(makeRequest({ url: 'https://192.168.1.1/x.json' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('blocked');
  });

  it('returns the body on a successful fetch', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('{"hello":"world"}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    const response = await POST(makeRequest({ url: 'https://example.com/x.json' }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      body: '{"hello":"world"}',
      contentType: 'application/json',
      finalUrl: 'https://example.com/x.json',
    });
  });

  it('rejects when body exceeds the size cap', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const largeBody = 'x'.repeat(11 * 1_048_576);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(largeBody, { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await POST(makeRequest({ url: 'https://example.com/big.json' }));
    const json = await response.json();
    expect(response.status).toBe(413);
    expect(json.error).toBe('too-large');
  });

  it('returns invalid-url for malformed input', async () => {
    const response = await POST(makeRequest({ url: 'not a url' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('invalid-url');
  });

  it('returns invalid-url when url is missing', async () => {
    const response = await POST(makeRequest({}));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('invalid-url');
  });
});

describe('POST /api/fetch accept selector (#811)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('sends the link set Accept profile when accept is "linkset"', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('{"linkset":[]}', { status: 200, headers: { 'content-type': 'application/linkset+json' } }),
      );
    global.fetch = fetchMock;

    const response = await POST(
      makeRequest({ url: 'https://resolver.example.org/01/1?linkType=all', accept: 'linkset' }),
    );
    expect(response.status).toBe(200);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Accept).toContain('application/linkset+json');
  });

  it('defaults to the JSON Accept profile when accept is omitted', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = fetchMock;

    await POST(makeRequest({ url: 'https://example.com/x.json' }));
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json, application/ld+json, */*;q=0.1');
  });

  it.each([null, 123, ''])('rejects a non-string or empty accept selector (%p) without fetching', async (accept) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const response = await POST(makeRequest({ url: 'https://example.com/x.json', accept }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'rejects the prototype-property selector %p before any network activity',
    async (accept) => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      const response = await POST(makeRequest({ url: 'https://example.com/x.json', accept }));
      const json = await response.json();
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      // The closed selector's contract: no DNS lookup and no fetch for an unknown value.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockedLookup).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown accept selector without fetching', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const response = await POST(makeRequest({ url: 'https://example.com/x.json', accept: 'text/anything' }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.message).toContain('accept');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
