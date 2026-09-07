/**
 * @jest-environment node
 */
// The loader is NOT mocked: a @context at a private address must be refused
// by the shared guard before any connection, and the refusal must reach the
// response in the shape the browser translates.
import { POST } from '@/app/api/context/route';

function post(document: unknown): Request {
  return new Request('http://localhost/api/context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ document }),
  });
}

describe('POST /api/context with the real guard', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each([
    ['a loopback address', 'https://127.0.0.1/ctx.jsonld'],
    ['the localhost name', 'https://localhost/ctx.jsonld'],
    ['the cloud metadata address', 'https://169.254.169.254/latest/ctx'],
    ['an RFC 1918 address', 'https://10.0.0.5/ctx.jsonld'],
  ])('refuses a @context at %s without connecting', async (_label, url) => {
    const response = await POST(post({ '@context': [url], type: ['Thing'] }));
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(422);
    // The refusal reaches the browser as one flat policy message naming the
    // caller's own URL and nothing else: no guard code, so a caller cannot
    // tell "does not resolve" from "resolves privately" per hostname.
    expect(json.failure).toEqual({
      kind: 'context-fetch',
      detail: "a remote @context URL was rejected by this service's URL policy or could not be resolved",
      url,
    });
  });

  it('refuses a plaintext http @context without fetching it', async () => {
    const plaintext = 'http://example.com/ctx.jsonld';
    const response = await POST(post({ '@context': [plaintext], type: ['Thing'] }));
    const json = (await response.json()) as { error: string; failure: Record<string, unknown> };
    expect(response.status).toBe(422);
    expect(json.failure).toEqual({
      kind: 'context-fetch',
      detail: "a remote @context URL was rejected by this service's URL policy or could not be resolved",
      url: plaintext,
    });
  });
});
