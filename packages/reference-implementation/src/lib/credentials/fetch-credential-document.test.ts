import { TextEncoder } from 'node:util';

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
  getFetchTimeoutMs,
  getMaxCredentialSize,
  isRetryable,
  type DocumentFetchFailure,
} from './fetch-credential-document';

// Loaded by relative path to the source file, NOT through
// '@uncefact/untp-utils/resolvers/errors'. The barrel mock above spreads that
// specifier, so anchoring the expectation on it too would make both sides move
// with the jest mapping and the identity assertion could never fail.
const { ResolverError: SourceResolverError, ResolverNetworkError: SourceResolverNetworkError } = jest.requireActual(
  '../../../../untp-utils/src/resolvers/errors',
) as {
  ResolverError: typeof ResolverError;
  ResolverNetworkError: typeof ResolverNetworkError;
};

const HREF = 'https://supplier.example/credential-a';
const FETCH_ENV_NAMES = [
  'FETCH_ALLOW_PRIVATE_URLS',
  'VERIFY_ALLOW_PRIVATE_URLS',
  'FETCH_MAX_RESPONSE_SIZE',
  'VERIFY_MAX_CREDENTIAL_SIZE',
  'FETCH_TIMEOUT_MS',
  'VERIFY_FETCH_TIMEOUT_MS',
] as const;
const originalFetchEnvironment = Object.fromEntries(FETCH_ENV_NAMES.map((name) => [name, process.env[name]]));

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
  beforeEach(() => {
    jest.clearAllMocks();
    for (const name of FETCH_ENV_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of FETCH_ENV_NAMES) delete process.env[name];
  });

  afterAll(() => {
    for (const name of FETCH_ENV_NAMES) {
      const value = originalFetchEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe('through the guarded resolver', () => {
    it('uses the FETCH_TIMEOUT_MS budget when the caller passes no timeout', async () => {
      // Every route and job that fetches a credential URL relies on this
      // default, so an operator's override must reach the resolver from here.
      // Fails if the helper keeps a fixed budget or reads the variable elsewhere.
      process.env.FETCH_TIMEOUT_MS = '3210';
      mockResolveDocument.mockResolvedValue({ body: new Uint8Array(), status: 200, finalUrl: HREF });
      try {
        await fetchCredentialDocument(HREF, { maxBytes: 512 });
      } finally {
        delete process.env.FETCH_TIMEOUT_MS;
      }
      expect(mockResolveDocument).toHaveBeenCalledWith(HREF, { maxResponseBytes: 512, totalTimeoutMs: 3_210 });
    });

    it.each([false, true])(
      'fetches through the resolver with the same budgets when private URLs are %s',
      async (privateUrls) => {
        if (privateUrls) process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';
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
        expect(mockResolveDocument).toHaveBeenCalledWith(HREF, {
          maxResponseBytes: 512,
          totalTimeoutMs: 2_000,
          ...(privateUrls ? { allowPrivateAddresses: true } : {}),
        });
      },
    );

    it('omits the content type when the server sent none', async () => {
      mockResolveDocument.mockResolvedValue({ body: new Uint8Array(), status: 200, finalUrl: HREF });
      await expect(fetchCredentialDocument(HREF)).resolves.toEqual({ bytes: new Uint8Array(), finalUrl: HREF });
    });

    it('treats the 304 the resolver returns without throwing as an HTTP failure', async () => {
      mockResolveDocument.mockResolvedValue({ body: new Uint8Array(), status: 304, finalUrl: HREF });

      const failure = await failureOf(fetchCredentialDocument(HREF));

      expect(failure).toMatchObject({ kind: 'failed', reason: 'http', status: 304 });
    });

    // One row per error class the resolver and the guard can throw, each with
    // the literal failure facts and the literal retryability it must produce.
    // Expectations are written out rather than computed from the rule under
    // test, so a change to `isRetryable` cannot move the code and this table
    // together and pass.
    describe.each([false, true])('with private URLs %s', (privateUrls) => {
      const cases = [
        [
          'a malformed URL',
          new InvalidUrlError('bad', new Error('parse')),
          { kind: 'rejected', reason: 'invalid-url' },
          false,
        ],
        [
          'a scheme the guard forbids',
          new UnsupportedSchemeError('ftp', ['http', 'https']),
          { kind: 'rejected', reason: 'source-not-permitted' },
          false,
        ],
        [
          'a private hostname',
          new PrivateHostnameError('localhost'),
          { kind: 'rejected', reason: 'source-not-permitted' },
          false,
        ],
        [
          'a private address',
          new PrivateAddressError('internal.test', ['10.0.0.1']),
          { kind: 'rejected', reason: 'source-not-permitted' },
          false,
        ],
        [
          'any other guard rejection',
          new UrlValidationError({ code: 'url.other', message: 'nope' }),
          { kind: 'rejected', reason: 'invalid-url' },
          false,
        ],
        [
          'a name that failed to resolve',
          new ResolutionFailedError('x.test', new Error('ENOTFOUND')),
          { kind: 'failed', reason: 'dns' },
          true,
        ],
        ['a name with no addresses', new ResolutionEmptyError('x.test'), { kind: 'failed', reason: 'dns' }, true],
        ['a timeout', new ResolverTimedOutError(HREF, 10_000), { kind: 'failed', reason: 'timeout' }, true],
        [
          'a network fault',
          new ResolverNetworkError(HREF, new Error('reset')),
          { kind: 'failed', reason: 'network' },
          true,
        ],
        [
          'an unclassified resolver fault',
          new ResolverError({ code: 'resolver.other', message: 'x' }),
          { kind: 'failed', reason: 'network' },
          true,
        ],
        ['an upstream 404', new ResolverHttpError(HREF, 404), { kind: 'failed', reason: 'http', status: 404 }, false],
        ['an upstream 401', new ResolverHttpError(HREF, 401), { kind: 'failed', reason: 'http', status: 401 }, false],
        ['an upstream 408', new ResolverHttpError(HREF, 408), { kind: 'failed', reason: 'http', status: 408 }, true],
        ['an upstream 429', new ResolverHttpError(HREF, 429), { kind: 'failed', reason: 'http', status: 429 }, true],
        ['an upstream 503', new ResolverHttpError(HREF, 503), { kind: 'failed', reason: 'http', status: 503 }, true],
        ['a body over the cap', new ResolverTooLargeError(HREF, 10), { kind: 'failed', reason: 'too-large' }, false],
        [
          'too many redirects',
          new ResolverTooManyRedirectsError(HREF, 5),
          { kind: 'failed', reason: 'redirects' },
          false,
        ],
        [
          'a redirect without a location',
          new ResolverRedirectMissingLocationError(HREF, 302),
          { kind: 'failed', reason: 'redirects' },
          false,
        ],
      ] as const;

      it.each(cases)(
        'preserves the failure facts and retryability for %s',
        async (_label, thrown, expected, retryable) => {
          if (privateUrls) process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';
          mockResolveDocument.mockRejectedValue(thrown);

          const failure = await failureOf(fetchCredentialDocument(HREF));

          expect(failure).toEqual({ ...expected, error: thrown });
          expect(isRetryable(failure)).toBe(retryable);
        },
      );
    });

    it.each([false, true])(
      'lets an unrecognised error propagate untouched when private URLs are %s',
      async (privateUrls) => {
        if (privateUrls) process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';
        const thrown = new Error('unexpected');
        mockResolveDocument.mockRejectedValue(thrown);
        await expect(fetchCredentialDocument(HREF)).rejects.toBe(thrown);
      },
    );

    it.each([false, true])(
      'reports the resolver response URL on HTTP failure when private URLs are %s',
      async (privateUrls) => {
        if (privateUrls) process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';
        const responder = `${HREF}/redirected`;
        const thrown = new ResolverHttpError(responder, 404);
        mockResolveDocument.mockRejectedValue(thrown);

        const failure = await failureOf(fetchCredentialDocument(HREF));

        expect(failure).toEqual({ kind: 'failed', reason: 'http', status: 404, error: thrown });
        expect((failure.error as ResolverHttpError).url).toBe(responder);
      },
    );

    it.each([false, true])('treats a resolver 304 as an HTTP failure when private URLs are %s', async (privateUrls) => {
      if (privateUrls) process.env.FETCH_ALLOW_PRIVATE_URLS = 'true';
      mockResolveDocument.mockResolvedValue({ body: new Uint8Array(), status: 304, finalUrl: `${HREF}/redirected` });

      const failure = await failureOf(fetchCredentialDocument(HREF));

      expect(failure).toMatchObject({ kind: 'failed', reason: 'http', status: 304 });
      expect(failure.error.message).toContain(`${HREF}/redirected`);
    });

    // Catches a jest mapping that points the resolvers' error alias at the
    // compiled build while the helper's `instanceof` checks run against the
    // source classes: the two class identities diverge and every resolver
    // error silently falls through to the unrecognised-error path.
    it('resolves the mocked barrel to the same error constructors as the source file', async () => {
      expect(ResolverError).toBe(SourceResolverError);
      expect(ResolverNetworkError).toBe(SourceResolverNetworkError);

      const thrown = new SourceResolverNetworkError(HREF, new Error('network failure'));
      expect(thrown).toBeInstanceOf(SourceResolverError);
      expect(thrown).toBeInstanceOf(ResolverError);
      expect(new ResolverNetworkError(HREF, new Error('network failure'))).toBeInstanceOf(SourceResolverError);
      mockResolveDocument.mockRejectedValue(thrown);

      const failure = await failureOf(fetchCredentialDocument(HREF));

      expect(failure).toEqual({ kind: 'failed', reason: 'network', error: thrown });
    });
  });

  // Both aliases have the same `(env?) => number` type, so swapping them
  // type-checks. These two cases are what fails when a rename points an alias
  // at the wrong reader.
  describe('the re-exported setting readers', () => {
    it('reads FETCH_MAX_RESPONSE_SIZE through the exported getMaxCredentialSize binding', () => {
      process.env.FETCH_MAX_RESPONSE_SIZE = '2048';
      expect(getMaxCredentialSize()).toBe(2048);
    });

    it('reads FETCH_TIMEOUT_MS through the exported getFetchTimeoutMs binding', () => {
      process.env.FETCH_TIMEOUT_MS = '3210';
      expect(getFetchTimeoutMs()).toBe(3210);
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
