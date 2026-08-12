/**
 * @jest-environment node
 */
import { httpFetch } from './client';
import { runWithRequestContext } from '../logging/request-context';

describe('httpFetch', () => {
  const mockFetch = jest.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  const sentHeaders = (): Headers => new Headers((mockFetch.mock.calls[0][1] as RequestInit).headers);

  it('forwards the request context correlation ID on outbound requests', async () => {
    await runWithRequestContext('ctx-42', () => httpFetch('https://storage.example.com/store'));

    expect(sentHeaders().get('x-correlation-id')).toBe('ctx-42');
  });

  it('mints a correlation ID when called outside a request context', async () => {
    await httpFetch('https://storage.example.com/store');

    expect(sentHeaders().get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('overwrites a caller-supplied correlation header with the request context ID', async () => {
    await runWithRequestContext('ctx-42', () =>
      httpFetch('https://storage.example.com/store', { headers: { 'x-correlation-id': 'stale-or-forged' } }),
    );

    expect(sentHeaders().get('x-correlation-id')).toBe('ctx-42');
  });

  it.each([
    ['a plain record', { Accept: 'application/json' } as HeadersInit],
    ['a tuple array', [['Accept', 'application/json']] as HeadersInit],
    ['a Headers instance', new Headers({ Accept: 'application/json' }) as HeadersInit],
  ])('merges the correlation header into %s', async (_shape, headers) => {
    await runWithRequestContext('ctx-42', () => httpFetch('https://storage.example.com/store', { headers }));

    expect(sentHeaders().get('accept')).toBe('application/json');
    expect(sentHeaders().get('x-correlation-id')).toBe('ctx-42');
  });

  it('preserves other request options and headers', async () => {
    await httpFetch('https://idr.example.com/links', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{}',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://idr.example.com/links');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(sentHeaders().get('authorization')).toBe('Bearer t');
    expect(sentHeaders().get('x-correlation-id')).toBeTruthy();
  });

  it('sends no correlation header to third-party hosts when correlate is false', async () => {
    await runWithRequestContext('ctx-42', () =>
      httpFetch('https://third-party.example.com/did.json', { correlate: false }),
    );

    expect(sentHeaders().get('x-correlation-id')).toBeNull();
  });

  it('strips a caller-supplied correlation header when correlate is false', async () => {
    await httpFetch('https://third-party.example.com/did.json', {
      correlate: false,
      headers: { 'x-correlation-id': 'internal-id' },
    });

    expect(sentHeaders().get('x-correlation-id')).toBeNull();
  });
});
