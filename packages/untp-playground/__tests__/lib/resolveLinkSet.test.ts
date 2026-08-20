import { normaliseResolverUrl, resolveLinkSet } from '@/lib/resolveLinkSet';

describe('normaliseResolverUrl', () => {
  it('appends ?linkType=all when the parameter is absent', () => {
    expect(normaliseResolverUrl('https://resolver.example.org/01/09520123456788')).toBe(
      'https://resolver.example.org/01/09520123456788?linkType=all',
    );
  });

  it('leaves an existing linkType parameter untouched', () => {
    expect(normaliseResolverUrl('https://resolver.example.org/01/1?linkType=gs1:pip')).toBe(
      'https://resolver.example.org/01/1?linkType=gs1:pip',
    );
  });

  it('preserves other query parameters while appending', () => {
    expect(normaliseResolverUrl('https://resolver.example.org/01/1?foo=bar')).toBe(
      'https://resolver.example.org/01/1?foo=bar&linkType=all',
    );
  });

  it('throws on input that is not a URL', () => {
    expect(() => normaliseResolverUrl('not a url')).toThrow();
  });

  it('strips fragments: they are never sent in a request, so they never make a distinct identity', () => {
    expect(normaliseResolverUrl('https://resolver.example.org/01/1#section')).toBe(
      'https://resolver.example.org/01/1?linkType=all',
    );
  });
});

describe('resolveLinkSet', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  // jsdom has no Response; resolveLinkSet only calls .json(), so a duck-typed result suffices.
  const proxyResponse = (payload: unknown) => ({ json: async () => payload });
  const proxyOk = (body: unknown, finalUrl: string) =>
    proxyResponse({ ok: true, body: JSON.stringify(body), contentType: 'application/linkset+json', finalUrl });

  it('requests the normalised URL through /api/fetch with the linkset accept selector', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(proxyOk({ linkset: [] }, 'https://r.example.org/01/1?linkType=all'));
    global.fetch = fetchMock;

    const result = await resolveLinkSet('https://r.example.org/01/1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/fetch'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://r.example.org/01/1?linkType=all', accept: 'linkset' }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      payload: { linkset: [] },
      requestUrl: 'https://r.example.org/01/1?linkType=all',
      finalUrl: 'https://r.example.org/01/1?linkType=all',
    });
  });

  it('returns invalid-url for unparseable input without fetching', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await resolveLinkSet('not a url');
    expect(result).toEqual({ ok: false, error: 'invalid-url', message: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the proxy error message when the fetch is blocked', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        proxyResponse({ ok: false, error: 'blocked', message: 'Hostname localhost is in a blocked range.' }),
      );

    const result = await resolveLinkSet('https://localhost/01/1');
    // The shared user-facing copy for the proxy's blocked code (#811 AC3), not the raw proxy message.
    expect(result).toEqual({
      ok: false,
      error: 'fetch-failed',
      message: 'That URL is blocked. Only https URLs to public hosts are allowed.',
    });
  });

  it('rejects a reachable response that is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      proxyResponse({
        ok: true,
        body: '<html>',
        contentType: 'text/html',
        finalUrl: 'https://r.example.org/x?linkType=all',
      }),
    );

    const result = await resolveLinkSet('https://r.example.org/x');
    expect(result).toEqual({ ok: false, error: 'not-json', message: expect.stringContaining('not valid JSON') });
  });

  it('rejects JSON that is not link-set shaped instead of showing an empty success', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(proxyOk({ hello: 'world' }, 'https://r.example.org/x?linkType=all'));

    const result = await resolveLinkSet('https://r.example.org/x');
    expect(result).toEqual({ ok: false, error: 'not-a-link-set', message: expect.stringContaining('linkset') });
  });

  it('returns fetch-failed when the proxy itself is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('network down'));

    const result = await resolveLinkSet('https://r.example.org/x');
    expect(result).toEqual({ ok: false, error: 'fetch-failed', message: expect.any(String) });
  });
});

describe('resolveLinkSet redirect drift (#811 replace contract)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('keeps the requestUrl stable when the resolver redirects to a per-request URL', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      json: async () => ({
        ok: true,
        body: JSON.stringify({ linkset: [] }),
        contentType: 'application/linkset+json',
        finalUrl: 'https://cdn.example.org/tokens/abc123/linkset.json',
      }),
    });

    const result = await resolveLinkSet('https://r.example.org/01/1');

    expect(result).toEqual({
      ok: true,
      payload: { linkset: [] },
      requestUrl: 'https://r.example.org/01/1?linkType=all',
      finalUrl: 'https://cdn.example.org/tokens/abc123/linkset.json',
    });
  });
});
