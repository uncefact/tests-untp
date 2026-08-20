import { jest } from '@jest/globals';
import { ReadableStream } from 'node:stream/web';
import { PrivateAddressError } from '../node/index.js';
import {
  ResolverHttpError,
  ResolverNetworkError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
} from './errors.js';

const undiciFetch = jest.fn();
let lastAgentClose: jest.Mock = jest.fn(() => Promise.resolve());
// Constructor options of every Agent created during a test, in creation
// order. The `connect.lookup` inside is the IP pin under test.
let agentOptions: unknown[] = [];
// The FakeAgent instances themselves, so tests can assert the dispatcher
// passed to fetch IS the pinned agent, not merely that a pinned agent exists.
let agentInstances: FakeAgent[] = [];

class FakeAgent {
  close: jest.Mock;
  constructor(options?: unknown) {
    agentOptions.push(options);
    agentInstances.push(this);
    this.close = jest.fn(() => Promise.resolve());
    lastAgentClose = this.close;
  }
}

jest.unstable_mockModule('undici', () => ({
  Agent: FakeAgent,
  fetch: undiciFetch,
}));

const validatePublicUrl = jest.fn();
jest.unstable_mockModule('../node/index.js', () => ({
  validatePublicUrl,
  PrivateAddressError,
}));

const { resolveDocument } = await import('./resolve-document.js');
const { DEFAULT_USER_AGENT, USER_AGENT_ENV_VAR } = await import('../http-headers/index.js');

function makeResponse(opts: {
  status?: number;
  ok?: boolean;
  body?: string | Uint8Array | null;
  headers?: Record<string, string>;
}) {
  const status = opts.status ?? 200;
  const headers = new Headers(opts.headers ?? {});
  let bodyStream: ReadableStream<Uint8Array> | null;
  if (opts.body === null || opts.body === undefined) {
    bodyStream = null;
  } else {
    const bytes = typeof opts.body === 'string' ? new TextEncoder().encode(opts.body) : opts.body;
    bodyStream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  return {
    status,
    ok: opts.ok ?? (status >= 200 && status < 300),
    headers,
    body: bodyStream,
  };
}

function resolvedAddress(address = '1.1.1.1', family: 4 | 6 = 4) {
  return { address, family };
}

describe('resolveDocument', () => {
  beforeEach(() => {
    agentOptions = [];
    agentInstances = [];
    undiciFetch.mockReset();
    validatePublicUrl.mockReset();
  });

  describe('SSRF guard', () => {
    it('propagates validatePublicUrl errors unwrapped and never calls fetch', async () => {
      validatePublicUrl.mockRejectedValue(new PrivateAddressError('https://attacker.example/', ['10.0.0.1']) as never);

      await expect(resolveDocument('https://attacker.example/')).rejects.toBeInstanceOf(PrivateAddressError);
      expect(undiciFetch).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('returns a LoadResult with body, digest, and the allowlisted headers', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(
        makeResponse({
          body: '{"hello":"world"}',
          headers: {
            'content-type': 'application/json',
            etag: '"abc"',
            'last-modified': 'Wed, 21 May 2026 12:00:00 GMT',
            'set-cookie': 'session=secret', // must NOT appear on the LoadResult
            'x-internal-trace': 'noisy', // ditto
          },
        }) as never,
      );

      const result = await resolveDocument('https://example.com/doc.json');

      expect(result.status).toBe(200);
      expect(result.finalUrl).toBe('https://example.com/doc.json');
      expect(result.etag).toBe('"abc"');
      expect(result.lastModified).toBe('Wed, 21 May 2026 12:00:00 GMT');
      expect(result.contentType).toBe('application/json');
      expect(new TextDecoder().decode(result.body)).toBe('{"hello":"world"}');
      expect(result.bodyDigest.toString()).toMatch(/^z[1-9A-HJ-NP-Za-km-z]+$/); // multibase base58btc
      // Arbitrary upstream headers must NOT be echoed onto the LoadResult.
      const valueAsRecord = result as unknown as Record<string, unknown>;
      expect(valueAsRecord['set-cookie']).toBeUndefined();
      expect(valueAsRecord['x-internal-trace']).toBeUndefined();
    });
  });

  describe('outbound headers', () => {
    it('sends only Accept-free defaults with a User-Agent and no correlation header', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: 'ok' }) as never);

      await resolveDocument('https://example.com/doc');

      const headers = (undiciFetch.mock.calls[0][1] as { headers: Record<string, string> }).headers;
      const names = Object.keys(headers).map((name) => name.toLowerCase());
      expect(names).toContain('user-agent');
      expect(names).not.toContain('x-correlation-id');
    });
  });

  describe('HTTP errors', () => {
    it('throws ResolverHttpError for a 4xx response with status attached', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 404, ok: false, body: 'not found' }) as never);

      const error = (await resolveDocument('https://example.com/missing').catch(
        (e: unknown) => e,
      )) as ResolverHttpError;
      expect(error).toBeInstanceOf(ResolverHttpError);
      expect(error.status).toBe(404);
      expect(error.url).toBe('https://example.com/missing');
    });

    it('carries the failing hop URL, not the original, when a redirect ends in an HTTP error', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'https://example.com/moved' }, body: null }) as never,
        )
        .mockResolvedValueOnce(makeResponse({ status: 404, ok: false, body: 'gone' }) as never);

      const error = (await resolveDocument('https://example.com/start').catch((e: unknown) => e)) as ResolverHttpError;
      expect(error).toBeInstanceOf(ResolverHttpError);
      expect(error.url).toBe('https://example.com/moved');
    });

    it('throws ResolverHttpError for a 5xx response', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 503, ok: false, body: 'busy' }) as never);

      const error = (await resolveDocument('https://example.com/busy').catch((e: unknown) => e)) as ResolverHttpError;
      expect(error).toBeInstanceOf(ResolverHttpError);
      expect(error.status).toBe(503);
    });
  });

  describe('network errors and timeouts', () => {
    it('throws ResolverNetworkError on fetch rejection', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockRejectedValue(new Error('ECONNREFUSED') as never);

      const error = (await resolveDocument('https://example.com/').catch((e: unknown) => e)) as ResolverNetworkError;
      expect(error).toBeInstanceOf(ResolverNetworkError);
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('throws ResolverTimedOutError when the fetch is aborted', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      undiciFetch.mockRejectedValue(abort as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBeInstanceOf(ResolverTimedOutError);
    });

    it('throws ResolverNetworkError when the response body stream rejects mid-read', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const erroringStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('connection reset by peer'));
        },
      });
      undiciFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: erroringStream,
      } as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBeInstanceOf(ResolverNetworkError);
    });
  });

  describe('size limit', () => {
    it('throws ResolverTooLargeError with limit attached when the body exceeds maxResponseBytes', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const big = new Uint8Array(2048);
      undiciFetch.mockResolvedValue(makeResponse({ body: big }) as never);

      const error = (await resolveDocument('https://example.com/big', { maxResponseBytes: 1024 }).catch(
        (e: unknown) => e,
      )) as ResolverTooLargeError;
      expect(error).toBeInstanceOf(ResolverTooLargeError);
      expect(error.limit).toBe(1024);
    });
  });

  describe('redirects', () => {
    it('follows a redirect chain within the cap', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'https://example.com/next' }, body: null }) as never,
        )
        .mockResolvedValueOnce(makeResponse({ body: 'final' }) as never);

      const result = await resolveDocument('https://example.com/start');
      expect(result.finalUrl).toBe('https://example.com/next');
      expect(new TextDecoder().decode(result.body)).toBe('final');
      expect(undiciFetch).toHaveBeenCalledTimes(2);
    });

    it('pins each hop connection to the address validatePublicUrl resolved', async () => {
      validatePublicUrl
        .mockResolvedValueOnce({ address: '203.0.113.10', family: 4 } as never)
        .mockResolvedValueOnce({ address: '2606:4700:4700::1111', family: 6 } as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'https://example.com/next' }, body: null }) as never,
        )
        .mockResolvedValueOnce(makeResponse({ body: 'final' }) as never);

      await resolveDocument('https://example.com/start');

      expect(agentOptions).toHaveLength(2);
      // Each hop's request must be dispatched through the agent that holds
      // that hop's pin; constructing a pinned agent and fetching without it
      // would satisfy the lookup assertions alone.
      expect(undiciFetch.mock.calls[0][1]).toMatchObject({ dispatcher: agentInstances[0] });
      expect(undiciFetch.mock.calls[1][1]).toMatchObject({ dispatcher: agentInstances[1] });
      const pins = await Promise.all(
        agentOptions.map(
          (options) =>
            new Promise((resolve, reject) => {
              const lookup = (
                options as {
                  connect: { lookup: (host: string, opts: object, cb: (err: unknown, addrs: unknown) => void) => void };
                }
              ).connect.lookup;
              lookup('example.com', {}, (err: unknown, addresses: unknown) => (err ? reject(err) : resolve(addresses)));
            }),
        ),
      );
      // Each hop's lookup must return exactly the address its own
      // validatePublicUrl call resolved, never a fresh DNS answer.
      expect(pins[0]).toEqual([{ address: '203.0.113.10', family: 4 }]);
      expect(pins[1]).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
    });

    it('re-validates each redirect target through validatePublicUrl', async () => {
      validatePublicUrl
        .mockResolvedValueOnce(resolvedAddress('1.1.1.1') as never)
        .mockRejectedValueOnce(new PrivateAddressError('https://internal.example/', ['10.0.0.1']) as never);
      undiciFetch.mockResolvedValueOnce(
        makeResponse({ status: 301, headers: { location: 'https://internal.example/' }, body: null }) as never,
      );

      await expect(resolveDocument('https://public.example/')).rejects.toBeInstanceOf(PrivateAddressError);
      expect(validatePublicUrl).toHaveBeenCalledTimes(2);
      // Second hop's URL must be the Location target, not the original.
      expect(validatePublicUrl).toHaveBeenNthCalledWith(2, 'https://internal.example/', expect.anything());
      expect(undiciFetch).toHaveBeenCalledTimes(1);
    });

    it('throws ResolverRedirectMissingLocationError when Location is not a parseable URL', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const malformed = 'http://[';
      undiciFetch.mockResolvedValue(
        makeResponse({ status: 301, headers: { location: malformed }, body: null }) as never,
      );

      const error = (await resolveDocument('https://example.com/').catch(
        (e: unknown) => e,
      )) as ResolverRedirectMissingLocationError;
      expect(error).toBeInstanceOf(ResolverRedirectMissingLocationError);
      expect(error.received).toBe(malformed);
    });

    it('throws ResolverTooManyRedirectsError with limit attached when the chain exceeds the cap', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(
        makeResponse({ status: 301, headers: { location: 'https://example.com/loop' }, body: null }) as never,
      );

      const error = (await resolveDocument('https://example.com/start', { maxRedirects: 1 }).catch(
        (e: unknown) => e,
      )) as ResolverTooManyRedirectsError;
      expect(error).toBeInstanceOf(ResolverTooManyRedirectsError);
      expect(error.limit).toBe(1);
    });

    it('throws ResolverRedirectMissingLocationError when a 3xx has no Location', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 302, body: null }) as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBeInstanceOf(
        ResolverRedirectMissingLocationError,
      );
    });
  });

  describe('dispatcher lifecycle', () => {
    it('closes the dispatcher only after the response body has been fully read', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const bodyPull = jest.fn();
      const slowStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          bodyPull();
          controller.enqueue(new TextEncoder().encode('chunk'));
          controller.close();
        },
      });
      undiciFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: slowStream,
      } as never);

      await resolveDocument('https://example.com/');

      expect(bodyPull).toHaveBeenCalled();
      expect(lastAgentClose).toHaveBeenCalled();
      const pullOrder = bodyPull.mock.invocationCallOrder[0];
      const closeOrder = lastAgentClose.mock.invocationCallOrder[0];
      expect(closeOrder).toBeGreaterThan(pullOrder);
    });
  });

  describe('User-Agent', () => {
    afterEach(() => {
      delete process.env[USER_AGENT_ENV_VAR];
    });

    function sentHeaders(callIndex = 0): Record<string, string> {
      const init = undiciFetch.mock.calls[callIndex][1] as { headers?: Record<string, string> };
      return init.headers ?? {};
    }

    it('sends the default User-Agent when the caller supplies none', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json', { headers: { Accept: 'application/json' } });

      expect(sentHeaders()['User-Agent']).toBe(DEFAULT_USER_AGENT);
      expect(sentHeaders()['Accept']).toBe('application/json');
    });

    it('sends the default User-Agent when no headers are supplied at all', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json');

      expect(sentHeaders()['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('prefers the RI_HTTP_USER_AGENT environment override to the default', async () => {
      process.env[USER_AGENT_ENV_VAR] = 'acme-operator/1.0';
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json');

      expect(sentHeaders()['User-Agent']).toBe('acme-operator/1.0');
    });

    it('falls back to the default when the environment override is blank (blank is treated as unset)', async () => {
      process.env[USER_AGENT_ENV_VAR] = '   ';
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json');

      expect(sentHeaders()['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('passes a non-blank override through unvalidated (boot-time validation owns rejection)', async () => {
      process.env[USER_AGENT_ENV_VAR] = 'operator-agent/1.0';
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json');

      expect(sentHeaders()['User-Agent']).toBe('operator-agent/1.0');
    });

    it('passes an invalid override through raw rather than silently substituting the default', async () => {
      process.env[USER_AGENT_ENV_VAR] = 'evil\r\nX-Injected: 1';
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json');

      // The load-bearing rule: no request-time fallback. The raw value reaches
      // the fetch layer, which rejects it loudly in real undici; deployments
      // that want fail-fast validate at boot instead.
      expect(sentHeaders()['User-Agent']).toBe('evil\r\nX-Injected: 1');
    });

    it.each(['user-agent', 'User-Agent', 'USER-AGENT', 'uSeR-aGeNt'])(
      'never overrides a caller-supplied %s header',
      async (headerName) => {
        process.env[USER_AGENT_ENV_VAR] = 'acme-operator/1.0';
        validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
        undiciFetch.mockResolvedValue(makeResponse({ body: '{}' }) as never);

        await resolveDocument('https://example.com/doc.json', { headers: { [headerName]: 'caller/2.0' } });

        const headers = sentHeaders();
        expect(headers[headerName]).toBe('caller/2.0');
        const uaKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'user-agent');
        expect(uaKeys).toEqual([headerName]);
      },
    );

    it('sends the User-Agent on every redirect hop', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 302, headers: { location: 'https://example.com/final' }, body: null }) as never,
        )
        .mockResolvedValueOnce(makeResponse({ body: '{}' }) as never);

      await resolveDocument('https://example.com/doc.json');

      expect(undiciFetch).toHaveBeenCalledTimes(2);
      expect(sentHeaders(0)['User-Agent']).toBe(DEFAULT_USER_AGENT);
      expect(sentHeaders(1)['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });
  });

  describe('304 Not Modified', () => {
    it('returns a LoadResult with status 304 and an empty body', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 304, body: null, headers: { etag: '"abc"' } }) as never);

      const result = await resolveDocument('https://example.com/');
      expect(result.status).toBe(304);
      expect(result.body.byteLength).toBe(0);
      expect(result.etag).toBe('"abc"');
    });
  });
});
