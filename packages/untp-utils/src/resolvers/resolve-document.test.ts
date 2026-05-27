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

class FakeAgent {
  close: jest.Mock;
  constructor() {
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

  describe('HTTP errors', () => {
    it('throws ResolverHttpError for a 4xx response with status attached', async () => {
      validatePublicUrl.mockResolvedValue(resolvedAddress() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 404, ok: false, body: 'not found' }) as never);

      const error = (await resolveDocument('https://example.com/missing').catch(
        (e: unknown) => e,
      )) as ResolverHttpError;
      expect(error).toBeInstanceOf(ResolverHttpError);
      expect(error.status).toBe(404);
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
