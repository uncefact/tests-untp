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
