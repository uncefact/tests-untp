import { jest } from '@jest/globals';
import { ReadableStream } from 'node:stream/web';
import { MultibaseDigest } from '../multibase-digest/index.js';
import { PrivateAddressError, ResolutionFailedError, type PublicUrlLookup } from '../node/index.js';
import {
  ResolverHttpError,
  ResolverNetworkError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
} from './errors.js';

const undiciFetch = jest.fn();
const NativeDOMException = (
  globalThis as unknown as {
    DOMException: new (message?: string, name?: string) => Error;
  }
).DOMException;
let lastAgentClose: jest.Mock = jest.fn(() => Promise.resolve());
let agentConstructionError: unknown;
let agentCloseImplementation: () => Promise<unknown> = () => Promise.resolve();
// Constructor options of every Agent created during a test, in creation
// order. The `connect.lookup` inside is the IP pin under test.
let agentOptions: unknown[] = [];
// The FakeAgent instances themselves, so tests can assert the dispatcher
// passed to fetch IS the pinned agent, not merely that a pinned agent exists.
let agentInstances: FakeAgent[] = [];

class FakeAgent {
  close: jest.Mock;
  constructor(options?: unknown) {
    if (agentConstructionError !== undefined) throw agentConstructionError;
    agentOptions.push(options);
    agentInstances.push(this);
    this.close = jest.fn(() => agentCloseImplementation());
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

/**
 * The shape `validatePublicUrl` returns for a single validated address:
 * `address` / `family` repeat the first entry of `addresses`, and the
 * resolver hands the whole of `addresses` to the connector.
 */
function resolvedAddress(address = '1.1.1.1', family: 4 | 6 = 4) {
  return { address, family, addresses: [{ address, family }] };
}

describe('resolveDocument', () => {
  beforeEach(() => {
    agentOptions = [];
    agentInstances = [];
    agentConstructionError = undefined;
    agentCloseImplementation = () => Promise.resolve();
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
    it('keeps the default DNS lookup path unchanged when no lookup is supplied', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: 'ok' }) as never);

      await resolveDocument('https://example.com/doc');

      expect(validatePublicUrl).toHaveBeenCalledWith('https://example.com/doc', {
        allowedSchemes: undefined,
        allowPrivateAddresses: undefined,
      });
    });

    it('forwards a supplied lookup to validation and pins its result into the connector', async () => {
      const lookup = jest
        .fn<PublicUrlLookup>()
        .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }])
        .mockResolvedValueOnce([{ address: '203.0.113.20', family: 4 }]);
      validatePublicUrl.mockImplementation(async (_url, options) => {
        const records = await (
          options as { lookup: (hostname: string, opts: { family: 0; all: true }) => Promise<unknown[]> }
        ).lookup('example.com', { family: 0, all: true });
        const [first] = records as { address: string; family: 4 | 6 }[];
        return { address: first.address, family: first.family, addresses: records } as never;
      });
      undiciFetch.mockResolvedValue(makeResponse({ body: 'ok' }) as never);

      await resolveDocument('https://example.com/doc', { lookup });

      expect(validatePublicUrl).toHaveBeenCalledWith('https://example.com/doc', expect.objectContaining({ lookup }));
      const connectorLookup = (
        agentOptions[0] as {
          connect: {
            lookup: (hostname: string, options: object, callback: (error: unknown, addresses: unknown) => void) => void;
          };
        }
      ).connect.lookup;
      const pinned = await new Promise((resolve, reject) => {
        connectorLookup('example.com', {}, (error, addresses) => (error ? reject(error) : resolve(addresses)));
      });
      expect(pinned).toEqual([{ address: '203.0.113.10', family: 4 }]);
      expect(lookup).toHaveBeenCalledTimes(1);
    });

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

    // A foreign abort-shaped rejection, synthesised here rather than observed
    // from undici: any abort that is not ours can arrive while our budget is
    // still running. Classifying on the name alone would report it as "timed
    // out after 10000ms" when our signal never fired. Fails if the deadline
    // check is dropped.
    it('reports an abort-named fetch rejection as a network error while our deadline has not passed', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const abort = new NativeDOMException('The operation was aborted.', 'AbortError');
      undiciFetch.mockRejectedValue(abort as never);

      const error = (await resolveDocument('https://example.com/').catch((e: unknown) => e)) as ResolverNetworkError;
      expect(error).toBeInstanceOf(ResolverNetworkError);
      expect(error.cause).toBe(abort);
    });

    // Same rule at the body-read await: an upstream body timeout is not our
    // budget expiring. Fails if `readWithLimit` classifies on the name alone.
    it('reports an abort-named body-read rejection as a network error while our deadline has not passed', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const abort = new NativeDOMException('The operation was aborted.', 'AbortError');
      const erroringStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(abort);
        },
      });
      undiciFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: erroringStream,
      } as never);

      const error = (await resolveDocument('https://example.com/').catch((e: unknown) => e)) as ResolverNetworkError;
      expect(error).toBeInstanceOf(ResolverNetworkError);
      expect(error.cause).toBe(abort);
    });

    it('reports an abort-named body-read rejection as a timeout once our deadline has passed', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const abort = new NativeDOMException('The operation was aborted.', 'AbortError');
      const reader = {
        read: jest.fn(() => new Promise((_resolve, reject) => setTimeout(() => reject(abort), 40))),
        cancel: jest.fn(() => Promise.resolve()),
      };
      undiciFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => reader },
      } as never);

      const error = (await resolveDocument('https://example.com/', { totalTimeoutMs: 10 }).catch(
        (e: unknown) => e,
      )) as ResolverTimedOutError;
      expect(error).toBeInstanceOf(ResolverTimedOutError);
      expect(error.cause).toBe(abort);
    });

    it('times out while the first-hop guard is unresolved without creating an Agent or fetching', async () => {
      let releaseGuard!: (value: { address: string; family: 4 | 6 }) => void;
      const guard = new Promise<{ address: string; family: 4 | 6 }>((resolve) => {
        releaseGuard = resolve;
      });
      validatePublicUrl.mockReturnValue(guard as never);

      const resolution = resolveDocument('https://slow-dns.example/', { totalTimeoutMs: 20 });
      await expect(resolution).rejects.toBeInstanceOf(ResolverTimedOutError);
      expect(agentInstances).toHaveLength(0);
      expect(undiciFetch).not.toHaveBeenCalled();

      releaseGuard(resolvedAddress());
      await Promise.resolve();
    });

    it('does not report a late guard rejection as unhandled after timeout', async () => {
      let rejectGuard!: (reason: Error) => void;
      const guard = new Promise<{ address: string; family: 4 | 6 }>((_resolve, reject) => {
        rejectGuard = reject;
      });
      validatePublicUrl.mockReturnValue(guard as never);

      await expect(resolveDocument('https://slow-dns.example/', { totalTimeoutMs: 20 })).rejects.toBeInstanceOf(
        ResolverTimedOutError,
      );

      const unhandledRejection = jest.fn();
      process.on('unhandledRejection', unhandledRejection);
      try {
        rejectGuard(new Error('late DNS failure'));
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        process.off('unhandledRejection', unhandledRejection);
      }
      expect(unhandledRejection).not.toHaveBeenCalled();
    });

    it('keeps the on-time DNS rejection unchanged', async () => {
      const dnsError = new ResolutionFailedError('example.com', new Error('ENOTFOUND'));
      validatePublicUrl.mockRejectedValue(dnsError as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBe(dnsError);
      expect(undiciFetch).not.toHaveBeenCalled();
    });

    // The paired case for the fetch await: the same abort-shaped rejection is
    // our timeout once the signal has fired.
    it('classifies an in-flight fetch abort as a timeout', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const abort = new NativeDOMException('The operation was aborted.', 'AbortError');
      undiciFetch.mockImplementation((_url: unknown, rawInit: unknown) => {
        const init = rawInit as { signal: AbortSignal };
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(abort), { once: true });
        });
      });

      const error = (await resolveDocument('https://example.com/', { totalTimeoutMs: 20 }).catch(
        (e: unknown) => e,
      )) as ResolverTimedOutError;
      expect(error).toBeInstanceOf(ResolverTimedOutError);
      expect(error.cause).toBe(abort);
    });
  });

  describe('defect propagation', () => {
    it('propagates a header-processing defect after a successful fetch unchanged', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const sentinel = new TypeError('header parser defect');
      const headers = {
        get: jest.fn(() => {
          throw sentinel;
        }),
      };
      undiciFetch.mockResolvedValue({ status: 200, ok: true, headers, body: null } as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBe(sentinel);
      expect(lastAgentClose).toHaveBeenCalled();
    });

    it('propagates an Agent construction defect unchanged', async () => {
      const sentinel = new TypeError('agent construction defect');
      agentConstructionError = sentinel;
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBe(sentinel);
      expect(undiciFetch).not.toHaveBeenCalled();
    });

    it('propagates a digest defect unchanged', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ body: 'ok' }) as never);
      const sentinel = new Error('digest defect');
      const digestSpy = jest.spyOn(MultibaseDigest, 'fromData').mockRejectedValue(sentinel);

      try {
        await expect(resolveDocument('https://example.com/')).rejects.toBe(sentinel);
      } finally {
        digestSpy.mockRestore();
      }
      expect(lastAgentClose).toHaveBeenCalled();
    });

    it('propagates a request-header construction defect before dispatch unchanged', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const sentinel = new TypeError('request header defect');
      const headers = Object.defineProperty({}, 'User-Agent', {
        enumerable: true,
        get: () => {
          throw sentinel;
        },
      });

      await expect(resolveDocument('https://example.com/', { headers })).rejects.toBe(sentinel);
      expect(undiciFetch).not.toHaveBeenCalled();
      // The Agent is constructed before the headers are materialised, so the
      // defect must still leave through the dispatcher's finally. Fails if the
      // header work moves outside that try and leaks the Agent.
      expect(lastAgentClose).toHaveBeenCalled();
    });

    // The sibling case above supplies an explicit `User-Agent`, which takes the
    // early-return branch of withUserAgent. This one has no caller
    // `User-Agent`, so the implicit branch spreads the caller's object to add
    // the generated header, and must read the throwing `Accept` getter there.
    // Fails if that branch stops materialising the caller's headers, which
    // would defer the defect into the transport instead of raising it here.
    it('propagates a request-header defect from the implicit User-Agent branch unchanged', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const sentinel = new TypeError('request header defect');
      const headers = Object.defineProperty({}, 'Accept', {
        enumerable: true,
        get: () => {
          throw sentinel;
        },
      });

      await expect(resolveDocument('https://example.com/', { headers })).rejects.toBe(sentinel);
      expect(undiciFetch).not.toHaveBeenCalled();
      expect(lastAgentClose).toHaveBeenCalled();
    });

    it('does not classify an abort-named processing defect as a timeout', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const sentinel = new TypeError('processing defect');
      sentinel.name = 'AbortError';
      const headers = {
        get: jest.fn(() => {
          throw sentinel;
        }),
      };
      undiciFetch.mockResolvedValue({ status: 200, ok: true, headers, body: null } as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBe(sentinel);
    });

    it('propagates a reader acquisition defect unchanged', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const sentinel = new TypeError('reader acquisition defect');
      undiciFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: {
          getReader: () => {
            throw sentinel;
          },
        },
      } as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBe(sentinel);
    });

    it('propagates a chunk-processing defect unchanged', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      const sentinel = new TypeError('chunk processing defect');
      const value = Object.defineProperty({}, 'byteLength', {
        get: () => {
          throw sentinel;
        },
      }) as unknown as Uint8Array;
      const reader = { read: jest.fn(), cancel: jest.fn() };
      reader.read.mockResolvedValue({ value, done: false } as never);
      reader.cancel.mockResolvedValue(undefined as never);
      undiciFetch.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: { getReader: () => reader },
      } as never);

      await expect(resolveDocument('https://example.com/')).rejects.toBe(sentinel);
      expect(reader.cancel).toHaveBeenCalledTimes(1);
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

    // The relaxed setting permits private destinations and nothing else. Fails
    // if the size cap is bypassed or widened when allowPrivateAddresses is on.
    it('applies the same size cap with allowPrivateAddresses on', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress('10.0.0.1') as never);
      const big = new Uint8Array(2048);
      undiciFetch.mockResolvedValue(makeResponse({ body: big }) as never);

      const error = (await resolveDocument('http://db.internal/big', {
        maxResponseBytes: 1024,
        allowPrivateAddresses: true,
      }).catch((e: unknown) => e)) as ResolverTooLargeError;
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

    it('pins each hop connection to the addresses validatePublicUrl resolved', async () => {
      validatePublicUrl
        .mockResolvedValueOnce(resolvedAddress('203.0.113.10', 4) as never)
        .mockResolvedValueOnce(resolvedAddress('2606:4700:4700::1111', 6) as never);
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
      // Each hop's lookup must return exactly the addresses its own
      // validatePublicUrl call resolved, never a fresh DNS answer.
      expect(pins[0]).toEqual([{ address: '203.0.113.10', family: 4 }]);
      expect(pins[1]).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
    });

    // The dual-stack `localhost` case: the guard validated both addresses, so
    // both must reach the connector, which is what lets Node's default
    // autoSelectFamily try the second when the first refuses the connection.
    it('hands the connector every address the guard validated for a hop', async () => {
      validatePublicUrl.mockResolvedValueOnce({
        address: '::1',
        family: 6,
        addresses: [
          { address: '::1', family: 6 },
          { address: '127.0.0.1', family: 4 },
        ],
      } as never);
      undiciFetch.mockResolvedValueOnce(makeResponse({ body: 'final' }) as never);

      await resolveDocument('http://localhost/doc', { allowPrivateAddresses: true });

      expect(agentOptions).toHaveLength(1);
      expect(undiciFetch.mock.calls[0][1]).toMatchObject({ dispatcher: agentInstances[0] });
      const pin = await new Promise((resolve, reject) => {
        const lookup = (
          agentOptions[0] as {
            connect: { lookup: (host: string, opts: object, cb: (err: unknown, addrs: unknown) => void) => void };
          }
        ).connect.lookup;
        lookup('localhost', {}, (err: unknown, addresses: unknown) => (err ? reject(err) : resolve(addresses)));
      });
      expect(pin).toEqual([
        { address: '::1', family: 6 },
        { address: '127.0.0.1', family: 4 },
      ]);
    });

    it('forwards private permission and pins each redirect hop through the guard', async () => {
      validatePublicUrl
        .mockResolvedValueOnce(resolvedAddress('10.0.0.1', 4) as never)
        .mockResolvedValueOnce(resolvedAddress('10.0.0.2', 4) as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'http://db.internal/next' }, body: null }) as never,
        )
        .mockResolvedValueOnce(makeResponse({ body: 'final' }) as never);

      await resolveDocument('http://localhost/start', { allowPrivateAddresses: true });

      expect(validatePublicUrl).toHaveBeenNthCalledWith(
        1,
        'http://localhost/start',
        expect.objectContaining({ allowPrivateAddresses: true }),
      );
      expect(validatePublicUrl).toHaveBeenNthCalledWith(
        2,
        'http://db.internal/next',
        expect.objectContaining({ allowPrivateAddresses: true }),
      );
      // Relaxed mode must dispatch through the pinned Agents too, exactly as
      // the strict sibling above asserts. Constructing a pinned Agent and then
      // fetching without it would satisfy the pin assertions below alone.
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
              lookup('ignored.example', {}, (err: unknown, addresses: unknown) =>
                err ? reject(err) : resolve(addresses),
              );
            }),
        ),
      );
      expect(pins).toEqual([[{ address: '10.0.0.1', family: 4 }], [{ address: '10.0.0.2', family: 4 }]]);
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
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'https://example.com/loop' }, body: null }) as never,
        )
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'https://example.com/final' }, body: null }) as never,
        );

      const error = (await resolveDocument('https://example.com/start', { maxRedirects: 1 }).catch(
        (e: unknown) => e,
      )) as ResolverTooManyRedirectsError;
      expect(error).toBeInstanceOf(ResolverTooManyRedirectsError);
      expect(error.limit).toBe(1);
      expect(error.lastHopUrl).toBe('https://example.com/loop');
      // The message names where the chain began and `.lastHopUrl` names who
      // answered last. Fails if the two are transposed, which would report the hop that
      // redirected as the start of the chain.
      expect(error.message).toContain('starting from https://example.com/start');
      expect(error.message).not.toContain('https://example.com/loop');
    });

    // Same cap, same responder, with the relaxed setting on. Fails if the hop
    // cap is bypassed or overridden when allowPrivateAddresses is on.
    it('applies the same redirect cap with allowPrivateAddresses on', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress('10.0.0.1') as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'http://db.internal/loop' }, body: null }) as never,
        )
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'http://db.internal/final' }, body: null }) as never,
        );

      const error = (await resolveDocument('http://db.internal/start', {
        maxRedirects: 1,
        allowPrivateAddresses: true,
      }).catch((e: unknown) => e)) as ResolverTooManyRedirectsError;
      expect(error).toBeInstanceOf(ResolverTooManyRedirectsError);
      expect(error.limit).toBe(1);
      expect(error.lastHopUrl).toBe('http://db.internal/loop');
      expect(undiciFetch).toHaveBeenCalledTimes(2);
    });

    // R6: the disclosed default of three additional hops, exercised rather
    // than restated as a constant. Four consecutive redirects must exhaust it,
    // and the error must name the hop that answered the fourth request. Fails
    // if the default changes or the responder is transposed.
    it('exhausts the default redirect cap of three additional hops', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      for (const location of [
        'https://example.com/r1',
        'https://example.com/r2',
        'https://example.com/r3',
        'https://example.com/r4',
      ]) {
        undiciFetch.mockResolvedValueOnce(makeResponse({ status: 301, headers: { location }, body: null }) as never);
      }

      const error = (await resolveDocument('https://example.com/start').catch(
        (e: unknown) => e,
      )) as ResolverTooManyRedirectsError;
      expect(error).toBeInstanceOf(ResolverTooManyRedirectsError);
      expect(error.limit).toBe(3);
      expect(undiciFetch).toHaveBeenCalledTimes(4);
      expect(undiciFetch.mock.calls[3][0]).toBe('https://example.com/r3');
      expect(error.lastHopUrl).toBe('https://example.com/r3');
    });

    // The post-loop throw is reachable only when the caller supplies a
    // negative limit, so no hop was ever validated and there is no responder
    // to name. Fails if that path is given a default `lastHopUrl`, which would
    // claim a response that never happened, or if the loop runs at all.
    it('throws ResolverTooManyRedirectsError with no lastHopUrl when the caller supplies a negative limit', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);

      const error = (await resolveDocument('https://example.com/start', { maxRedirects: -1 }).catch(
        (e: unknown) => e,
      )) as ResolverTooManyRedirectsError;
      expect(error).toBeInstanceOf(ResolverTooManyRedirectsError);
      expect(error.lastHopUrl).toBeUndefined();
      expect(error.limit).toBe(-1);
      expect(error.message).toContain('https://example.com/start');
      expect(validatePublicUrl).not.toHaveBeenCalled();
      expect(undiciFetch).not.toHaveBeenCalled();
    });

    it('does not call the second-hop guard after redirect cleanup consumes the timeout budget', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(
        makeResponse({ status: 301, headers: { location: 'https://example.com/next' }, body: null }) as never,
      );
      agentCloseImplementation = () => new Promise((resolve) => setTimeout(resolve, 30));

      await expect(resolveDocument('https://example.com/start', { totalTimeoutMs: 5 })).rejects.toBeInstanceOf(
        ResolverTimedOutError,
      );
      expect(validatePublicUrl).toHaveBeenCalledTimes(1);
      expect(agentInstances).toHaveLength(1);
      expect(undiciFetch).toHaveBeenCalledTimes(1);
    });

    it('uses the live redirect hop when a second-hop guard remains unresolved at timeout', async () => {
      let releaseGuard!: (value: { address: string; family: 4 | 6 }) => void;
      const guard = new Promise<{ address: string; family: 4 | 6 }>((resolve) => {
        releaseGuard = resolve;
      });
      validatePublicUrl.mockResolvedValueOnce(resolvedAddress() as never).mockReturnValueOnce(guard as never);
      undiciFetch.mockResolvedValueOnce(
        makeResponse({ status: 301, headers: { location: 'https://example.com/next' }, body: null }) as never,
      );

      const error = (await resolveDocument('https://example.com/start', { totalTimeoutMs: 20 }).catch(
        (e: unknown) => e,
      )) as ResolverTimedOutError;
      expect(error).toBeInstanceOf(ResolverTimedOutError);
      expect(error.message).toContain('https://example.com/next');
      expect(validatePublicUrl).toHaveBeenCalledTimes(2);
      expect(agentInstances).toHaveLength(1);
      expect(undiciFetch).toHaveBeenCalledTimes(1);

      releaseGuard(resolvedAddress());
      await Promise.resolve();
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
