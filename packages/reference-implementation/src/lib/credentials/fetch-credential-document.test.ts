import { TextDecoder, TextEncoder } from 'node:util';

const mockResolveDocument = jest.fn();
jest.mock('@uncefact/untp-utils/resolvers', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/resolvers/errors');
  return { ...actual, resolveDocument: (...args: unknown[]) => mockResolveDocument(...args) };
});

import {
  ResolverError,
  ResolverHttpError,
  ResolverNetworkError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
} from '@uncefact/untp-utils/resolvers';
import {
  InvalidUrlError,
  PrivateAddressError,
  PrivateHostnameError,
  ResolutionEmptyError,
  ResolutionFailedError,
  UnsupportedSchemeError,
  UrlValidationError,
} from '@uncefact/untp-utils/node';
import {
  CredentialDocumentFetchError,
  fetchCredentialDocument,
  getMaxCredentialSize,
  isRetryable,
  type DocumentFetchFailure,
} from './fetch-credential-document';

const HREF = 'https://supplier.example/credential-a';
const mockFetch = jest.fn();

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CredentialDocumentFetchError) return error.failure;
    throw error;
  }
  throw new Error('expected the fetch to fail');
}

describe('fetchCredentialDocument', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VERIFY_ALLOW_PRIVATE_URLS;
    delete process.env.VERIFY_MAX_CREDENTIAL_SIZE;
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('through the guarded resolver', () => {
    it('returns the bytes, final URL and content type, passing the cap and timeout to the resolver', async () => {
      const body = new TextEncoder().encode('{"a":1}');
      mockResolveDocument.mockResolvedValue({
        body,
        status: 200,
        finalUrl: `${HREF}/final`,
        contentType: 'application/json',
      });

      await expect(fetchCredentialDocument(HREF, { maxBytes: 512, timeoutMs: 2_000 })).resolves.toEqual({
        bytes: body,
        finalUrl: `${HREF}/final`,
        contentType: 'application/json',
      });
      expect(mockResolveDocument).toHaveBeenCalledWith(HREF, { maxResponseBytes: 512, totalTimeoutMs: 2_000 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('omits the content type when the server sent none', async () => {
      mockResolveDocument.mockResolvedValue({ body: new Uint8Array(), status: 200, finalUrl: HREF });
      await expect(fetchCredentialDocument(HREF)).resolves.toEqual({ bytes: new Uint8Array(), finalUrl: HREF });
    });

    it('treats the 304 the resolver returns without throwing as an HTTP failure', async () => {
      mockResolveDocument.mockResolvedValue({ body: new Uint8Array(), status: 304, finalUrl: HREF });

      const failure = await failureOf(fetchCredentialDocument(HREF));

      expect(failure).toMatchObject({ kind: 'failed', reason: 'http', status: 304 });
    });

    it.each([
      ['a malformed URL', new InvalidUrlError('bad', new Error('parse')), { kind: 'rejected', reason: 'invalid-url' }],
      [
        'a scheme the guard forbids',
        new UnsupportedSchemeError('ftp', ['http', 'https']),
        { kind: 'rejected', reason: 'source-not-permitted' },
      ],
      [
        'a private hostname',
        new PrivateHostnameError('localhost'),
        { kind: 'rejected', reason: 'source-not-permitted' },
      ],
      [
        'a private address',
        new PrivateAddressError('internal.test', ['10.0.0.1']),
        { kind: 'rejected', reason: 'source-not-permitted' },
      ],
      [
        'any other guard rejection',
        new UrlValidationError({ code: 'url.other', message: 'nope' }),
        { kind: 'rejected', reason: 'invalid-url' },
      ],
      [
        'a name that failed to resolve',
        new ResolutionFailedError('x.test', new Error('ENOTFOUND')),
        { kind: 'failed', reason: 'dns' },
      ],
      ['a name with no addresses', new ResolutionEmptyError('x.test'), { kind: 'failed', reason: 'dns' }],
      ['a timeout', new ResolverTimedOutError(HREF, 10_000), { kind: 'failed', reason: 'timeout' }],
      ['a network fault', new ResolverNetworkError(HREF, new Error('reset')), { kind: 'failed', reason: 'network' }],
      [
        'an unclassified resolver fault',
        new ResolverError({ code: 'resolver.other', message: 'x' }),
        { kind: 'failed', reason: 'network' },
      ],
      ['an upstream 404', new ResolverHttpError(HREF, 404), { kind: 'failed', reason: 'http', status: 404 }],
      ['an upstream 401', new ResolverHttpError(HREF, 401), { kind: 'failed', reason: 'http', status: 401 }],
      ['an upstream 408', new ResolverHttpError(HREF, 408), { kind: 'failed', reason: 'http', status: 408 }],
      ['an upstream 429', new ResolverHttpError(HREF, 429), { kind: 'failed', reason: 'http', status: 429 }],
      ['an upstream 503', new ResolverHttpError(HREF, 503), { kind: 'failed', reason: 'http', status: 503 }],
      ['a body over the cap', new ResolverTooLargeError(HREF, 10), { kind: 'failed', reason: 'too-large' }],
      ['too many redirects', new ResolverTooManyRedirectsError(HREF, 5), { kind: 'failed', reason: 'redirects' }],
      [
        'a redirect without a location',
        new ResolverRedirectMissingLocationError(HREF, 302),
        { kind: 'failed', reason: 'redirects' },
      ],
    ])('classifies %s', async (_label, thrown, expected) => {
      mockResolveDocument.mockRejectedValue(thrown);

      const failure = await failureOf(fetchCredentialDocument(HREF));

      expect(failure).toEqual({ ...expected, error: thrown });
    });

    it('lets an unrecognised error propagate untouched', async () => {
      const thrown = new Error('unexpected');
      mockResolveDocument.mockRejectedValue(thrown);
      await expect(fetchCredentialDocument(HREF)).rejects.toBe(thrown);
    });
  });

  describe('with VERIFY_ALLOW_PRIVATE_URLS=true', () => {
    function response(init: {
      ok?: boolean;
      status?: number;
      body?: Uint8Array;
      contentType?: string;
      url?: string;
      readFails?: boolean;
    }) {
      const body = init.body ?? new Uint8Array();
      return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        url: init.url ?? '',
        headers: { get: (name: string) => (name === 'content-type' ? init.contentType ?? null : null) },
        arrayBuffer: async () => {
          if (init.readFails) throw new Error('stream reset');
          return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        },
      };
    }

    beforeEach(() => {
      process.env.VERIFY_ALLOW_PRIVATE_URLS = 'true';
    });

    it('uses a plain fetch with a timeout signal and never the resolver', async () => {
      const body = new TextEncoder().encode('hello');
      mockFetch.mockResolvedValue(response({ body, contentType: 'text/plain', url: `${HREF}/moved` }));

      const document = await fetchCredentialDocument(HREF);
      // The bytes come back through the fetch response's own realm, so they
      // are compared by content rather than by typed-array identity.
      expect(new TextDecoder().decode(document.bytes)).toBe('hello');
      expect(document).toMatchObject({ finalUrl: `${HREF}/moved`, contentType: 'text/plain' });
      expect(mockResolveDocument).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(HREF, { signal: expect.any(AbortSignal) });
    });

    it('classifies a timeout', async () => {
      const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      mockFetch.mockRejectedValueOnce(timeout);
      expect(await failureOf(fetchCredentialDocument(HREF))).toEqual({
        kind: 'failed',
        reason: 'timeout',
        error: timeout,
      });
    });

    it('classifies a network fault', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({ kind: 'failed', reason: 'network' });
    });

    it('reads a name that did not resolve and an exhausted redirect chain from the rejection cause', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({ kind: 'failed', reason: 'dns' });

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } }));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({ kind: 'failed', reason: 'dns' });

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed', { cause: new Error('redirect count exceeded') }));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({ kind: 'failed', reason: 'redirects' });
    });

    it('aborts the plain fetch after the timeout', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
      mockFetch.mockResolvedValueOnce(response({ body: new Uint8Array([123, 125]) }));
      await fetchCredentialDocument(HREF, { timeoutMs: 1_234 });
      expect(timeoutSpy).toHaveBeenCalledWith(1_234);
      timeoutSpy.mockRestore();
    });

    it('classifies a non-2xx status with the status it saw', async () => {
      mockFetch.mockResolvedValueOnce(response({ ok: false, status: 403 }));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({
        kind: 'failed',
        reason: 'http',
        status: 403,
      });

      mockFetch.mockResolvedValueOnce(response({ ok: false, status: 502 }));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({
        kind: 'failed',
        reason: 'http',
        status: 502,
      });
    });

    it('classifies an unreadable body', async () => {
      mockFetch.mockResolvedValueOnce(response({ readFails: true }));
      expect(await failureOf(fetchCredentialDocument(HREF))).toMatchObject({
        kind: 'failed',
        reason: 'body-unreadable',
      });
    });

    it('classifies an oversize body and reports how large it was', async () => {
      mockFetch.mockResolvedValueOnce(response({ body: new Uint8Array(11) }));
      expect(await failureOf(fetchCredentialDocument(HREF, { maxBytes: 10 }))).toMatchObject({
        kind: 'failed',
        reason: 'too-large',
        observedBytes: 11,
      });
    });

    it('counts the cap in bytes, not characters', async () => {
      // Three characters, but six bytes once encoded.
      const body = new TextEncoder().encode('ééé');
      mockFetch.mockResolvedValue(response({ body }));
      expect(await failureOf(fetchCredentialDocument(HREF, { maxBytes: 5 }))).toMatchObject({ reason: 'too-large' });
    });
  });

  describe('getMaxCredentialSize', () => {
    it('defaults to 10 MB and honours a positive override only', () => {
      expect(getMaxCredentialSize()).toBe(10_485_760);
      process.env.VERIFY_MAX_CREDENTIAL_SIZE = '2048';
      expect(getMaxCredentialSize()).toBe(2048);
      process.env.VERIFY_MAX_CREDENTIAL_SIZE = '-1';
      expect(getMaxCredentialSize()).toBe(10_485_760);
      process.env.VERIFY_MAX_CREDENTIAL_SIZE = 'lots';
      expect(getMaxCredentialSize()).toBe(10_485_760);
    });
  });

  describe('isRetryable', () => {
    const failed = (reason: DocumentFetchFailure['reason'], status?: number) =>
      ({
        kind: 'failed',
        reason,
        ...(status !== undefined ? { status } : {}),
        error: new Error('x'),
      }) as DocumentFetchFailure;

    it('treats 408, 429 and the temporary 5xx as retryable and every other status as a refusal', () => {
      expect([408, 429, 500, 502, 503, 504].map((status) => isRetryable(failed('http', status)))).toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
      ]);
      expect([501, 505, 508, 511].map((status) => isRetryable(failed('http', status)))).toEqual([
        false,
        false,
        false,
        false,
      ]);
      expect([400, 401, 403, 404, 410, 422].map((status) => isRetryable(failed('http', status)))).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    });

    it('treats transient faults as retryable and deterministic refusals as not', () => {
      expect(['dns', 'network', 'timeout', 'body-unreadable'].map((r) => isRetryable(failed(r as never)))).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(['too-large', 'redirects'].map((r) => isRetryable(failed(r as never)))).toEqual([false, false]);
      expect(isRetryable({ kind: 'rejected', reason: 'invalid-url', error: new Error('x') })).toBe(false);
      expect(isRetryable({ kind: 'rejected', reason: 'source-not-permitted', error: new Error('x') })).toBe(false);
    });
  });
});
