/**
 * @jest-environment node
 */
// The loader is NOT mocked here: these cases prove the shared guard refuses a
// private or loopback schema host before any connection is attempted, which is
// the route's whole SSRF posture now that it carries no hostname allowlist.
import { GET } from '@/app/api/schema/route';

function makeRequest(url: string): Request {
  const target = new URL('http://localhost/api/schema');
  target.searchParams.set('url', url);
  return new Request(target);
}

describe('GET /api/schema with the real guard', () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it.each([
    ['a loopback address', 'https://127.0.0.1/schema.json'],
    ['the localhost name', 'https://localhost/schema.json'],
    ['an RFC 1918 address', 'https://10.0.0.5/schema.json'],
    ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data'],
    ['an IPv6 loopback', 'https://[::1]/schema.json'],
  ])('refuses %s as unreachable without connecting', async (_label, url) => {
    const response = await GET(makeRequest(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The schema could not be loaded from its host',
      code: 'unreachable',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Schema fetch failed',
      expect.objectContaining({ url, causeCode: expect.stringMatching(/^url\./) }),
    );
  });
});
