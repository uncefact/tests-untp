import { jest } from '@jest/globals';
import { ReadableStream } from 'node:stream/web';
import { NodeUrlValidationCode } from '../node/index.js';
import { ResolverCode } from './codes.js';

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

function validUrl(address = '1.1.1.1', family: 4 | 6 = 4) {
  return { value: { address, family }, errors: [], warnings: [] };
}

describe('resolveDocument', () => {
  beforeEach(() => {
    undiciFetch.mockReset();
    validatePublicUrl.mockReset();
  });

  describe('SSRF guard', () => {
    it('propagates validation errors and never calls fetch', async () => {
      validatePublicUrl.mockResolvedValue({
        errors: [{ code: NodeUrlValidationCode.PrivateAddress, message: 'private', received: ['10.0.0.1'] }],
        warnings: [],
      } as never);

      const outcome = await resolveDocument('https://attacker.example/');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: NodeUrlValidationCode.PrivateAddress }));
      expect(outcome.value).toBeUndefined();
      expect(undiciFetch).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('returns a LoadResult with body, digest, and the allowlisted headers', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
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

      const outcome = await resolveDocument('https://example.com/doc.json');

      expect(outcome.errors).toEqual([]);
      expect(outcome.value).toBeDefined();
      expect(outcome.value!.status).toBe(200);
      expect(outcome.value!.finalUrl).toBe('https://example.com/doc.json');
      expect(outcome.value!.etag).toBe('"abc"');
      expect(outcome.value!.lastModified).toBe('Wed, 21 May 2026 12:00:00 GMT');
      expect(outcome.value!.contentType).toBe('application/json');
      expect(new TextDecoder().decode(outcome.value!.body)).toBe('{"hello":"world"}');
      expect(outcome.value!.bodyDigest.toString()).toMatch(/^z[1-9A-HJ-NP-Za-km-z]+$/); // multibase base58btc
      // Verify that arbitrary upstream headers are NOT echoed onto the LoadResult.
      const valueAsRecord = outcome.value as unknown as Record<string, unknown>;
      expect(valueAsRecord['set-cookie']).toBeUndefined();
      expect(valueAsRecord['x-internal-trace']).toBeUndefined();
    });
  });

  describe('HTTP errors', () => {
    it('emits HttpError for a 4xx response', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 404, ok: false, body: 'not found' }) as never);

      const outcome = await resolveDocument('https://example.com/missing');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: ResolverCode.HttpError, received: 404 }));
    });

    it('emits HttpError for a 5xx response', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 503, ok: false, body: 'busy' }) as never);

      const outcome = await resolveDocument('https://example.com/busy');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: ResolverCode.HttpError, received: 503 }));
    });
  });

  describe('network errors and timeouts', () => {
    it('emits NetworkError on fetch rejection', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch.mockRejectedValue(new Error('ECONNREFUSED') as never);

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({ code: ResolverCode.NetworkError, received: 'ECONNREFUSED' }),
      );
    });

    it('emits TimedOut when the fetch is aborted', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      undiciFetch.mockRejectedValue(abort as never);

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: ResolverCode.TimedOut }));
    });

    it('emits NetworkError when the response body stream rejects mid-read', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
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

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: ResolverCode.NetworkError,
          received: 'connection reset by peer',
        }),
      );
    });
  });

  describe('size limit', () => {
    it('emits TooLarge when the body exceeds maxResponseBytes', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      const big = new Uint8Array(2048);
      undiciFetch.mockResolvedValue(makeResponse({ body: big }) as never);

      const outcome = await resolveDocument('https://example.com/big', { maxResponseBytes: 1024 });

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: ResolverCode.TooLarge, received: 1024 }));
    });
  });

  describe('redirects', () => {
    it('follows a redirect chain within the cap', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch
        .mockResolvedValueOnce(
          makeResponse({ status: 301, headers: { location: 'https://example.com/next' }, body: null }) as never,
        )
        .mockResolvedValueOnce(makeResponse({ body: 'final' }) as never);

      const outcome = await resolveDocument('https://example.com/start');

      expect(outcome.errors).toEqual([]);
      expect(outcome.value!.finalUrl).toBe('https://example.com/next');
      expect(new TextDecoder().decode(outcome.value!.body)).toBe('final');
      expect(undiciFetch).toHaveBeenCalledTimes(2);
    });

    it('re-validates each redirect target through validatePublicUrl', async () => {
      validatePublicUrl.mockResolvedValueOnce(validUrl('1.1.1.1') as never).mockResolvedValueOnce({
        errors: [{ code: NodeUrlValidationCode.PrivateAddress, message: 'private', received: ['10.0.0.1'] }],
        warnings: [],
      } as never);
      undiciFetch.mockResolvedValueOnce(
        makeResponse({ status: 301, headers: { location: 'https://internal.example/' }, body: null }) as never,
      );

      const outcome = await resolveDocument('https://public.example/');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: NodeUrlValidationCode.PrivateAddress }));
      expect(validatePublicUrl).toHaveBeenCalledTimes(2);
      // The second hop's URL must be the Location target, not the original
      // URL; otherwise the SSRF check is meaningless on redirects.
      expect(validatePublicUrl).toHaveBeenNthCalledWith(2, 'https://internal.example/', expect.anything());
      expect(undiciFetch).toHaveBeenCalledTimes(1);
    });

    it('emits RedirectMissingLocation when the Location header is not a parseable URL', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      const malformed = 'http://[';
      undiciFetch.mockResolvedValue(
        makeResponse({ status: 301, headers: { location: malformed }, body: null }) as never,
      );

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors[0]).toEqual(
        expect.objectContaining({
          code: ResolverCode.RedirectMissingLocation,
          received: malformed,
        }),
      );
      expect(outcome.value).toBeUndefined();
    });

    it('emits TooManyRedirects when the chain exceeds the cap', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch.mockResolvedValue(
        makeResponse({ status: 301, headers: { location: 'https://example.com/loop' }, body: null }) as never,
      );

      const outcome = await resolveDocument('https://example.com/start', { maxRedirects: 1 });

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: ResolverCode.TooManyRedirects, received: 1 }));
    });

    it('emits RedirectMissingLocation when a 3xx has no Location', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 302, body: null }) as never);

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: ResolverCode.RedirectMissingLocation }));
    });
  });

  describe('dispatcher lifecycle', () => {
    it('closes the dispatcher only after the response body has been fully read', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      // Real undici Agent.close() waits for active requests to drain (and a
      // request only drains once its body has been consumed). Closing before
      // the body read deadlocks. With mocked Agent the deadlock doesn't
      // manifest, so the test instead asserts call order via jest's globally
      // monotonic `invocationCallOrder` counters.
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

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors).toEqual([]);
      expect(bodyPull).toHaveBeenCalled();
      expect(lastAgentClose).toHaveBeenCalled();
      const pullOrder = bodyPull.mock.invocationCallOrder[0];
      const closeOrder = lastAgentClose.mock.invocationCallOrder[0];
      expect(closeOrder).toBeGreaterThan(pullOrder);
    });
  });

  describe('304 Not Modified', () => {
    it('returns a LoadResult with status 304 and an empty body', async () => {
      validatePublicUrl.mockResolvedValue(validUrl() as never);
      undiciFetch.mockResolvedValue(makeResponse({ status: 304, body: null, headers: { etag: '"abc"' } }) as never);

      const outcome = await resolveDocument('https://example.com/');

      expect(outcome.errors).toEqual([]);
      expect(outcome.value!.status).toBe(304);
      expect(outcome.value!.body.byteLength).toBe(0);
      expect(outcome.value!.etag).toBe('"abc"');
    });
  });
});
