/**
 * The one fetch for a caller-supplied credential URL (#955). It always uses
 * the guarded resolver and, when enabled for local development,
 * `FETCH_ALLOW_PRIVATE_URLS=true` permits private destinations without
 * removing the resolver's other checks. It returns bytes and reports failures
 * as typed facts. Each route maps those facts to its own responses, so a route
 * that reads a DNS failure or a 404 differently from the verify route does not
 * need a second fetch.
 *
 * Its three settings live in `credential-fetch.config.ts` and are shared with
 * external registration and the supplier-source check used by re-verification:
 * `FETCH_ALLOW_PRIVATE_URLS`, which also relaxes the existing stored-address
 * URL checks, `FETCH_MAX_RESPONSE_SIZE` and `FETCH_TIMEOUT_MS`. Each is read
 * per invocation, so a change made after boot takes effect on the next fetch.
 * That module owns the deprecated-name window and the conflict rule.
 */
import {
  resolveDocument,
  ResolverError,
  ResolverHttpError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
} from '@uncefact/untp-utils/resolvers';
import {
  PrivateAddressError,
  PrivateHostnameError,
  ResolutionEmptyError,
  ResolutionFailedError,
  UnsupportedSchemeError,
  UrlValidationError,
} from '@uncefact/untp-utils/node';
import {
  readFetchAllowPrivateUrls,
  readFetchMaxResponseSize as getMaxCredentialSize,
  readFetchTimeoutMs as getFetchTimeoutMs,
} from '@/lib/config/credential-fetch.config';

export { getMaxCredentialSize, getFetchTimeoutMs };

/** Whether local development may fetch private or reserved destinations. */
export function allowsPrivateUrls(): boolean {
  return readFetchAllowPrivateUrls();
}

export type FetchedDocument = {
  bytes: Uint8Array;
  /** The response's Content-Type header, when the server sent one. */
  contentType?: string;
  /** The URL the body was read from, after any redirects. */
  finalUrl: string;
};

/**
 * Why a fetch produced no document. `rejected` is a fault in the request
 * the guard refuses to make, on the first hop or on a redirect hop. The URL
 * is malformed, or its scheme or destination is not permitted. `failed` is a
 * fault while retrieving. Whether a retry may succeed is derived by
 * {@link isRetryable}, never stored, so the rule lives in one place.
 *
 * Two facts in this union are unreachable through the single resolver path
 * this module now uses. `observedBytes` is never set, because the resolver
 * stops at the cap rather than buffering the whole body first and so knows
 * only the limit. `body-unreadable` is never produced, because a body that
 * will not read arrives as a resolver network failure and is classified
 * `network`. Both stay in the union: the shape is the recorded one and
 * consumers already switch on it. Retiring them is a follow-up, not part of
 * this change.
 */
export type DocumentFetchFailure =
  | { kind: 'rejected'; reason: 'invalid-url' | 'source-not-permitted'; error: Error }
  | { kind: 'failed'; reason: 'http'; status: number; error: Error }
  | {
      kind: 'failed';
      reason: 'too-large';
      /** The bytes actually read. Never set by the current fetch path; retained for existing consumers. */
      observedBytes?: number;
      error: Error;
    }
  | { kind: 'failed'; reason: 'dns' | 'network' | 'timeout' | 'redirects' | 'body-unreadable'; error: Error };

/**
 * Whether the same request may plausibly succeed later. This says nothing
 * about whose fault the failure was. A DNS fault is retryable; route status
 * presentation is owned by each route.
 */
export function isRetryable(failure: DocumentFetchFailure): boolean {
  if (failure.kind === 'rejected') return false;
  switch (failure.reason) {
    case 'http':
      return isRetryableStatus(failure.status);
    case 'too-large':
    case 'redirects':
      return false;
    default:
      return true;
  }
}

export class CredentialDocumentFetchError extends Error {
  readonly failure: DocumentFetchFailure;

  constructor(failure: DocumentFetchFailure) {
    super(failure.error.message, { cause: failure.error });
    this.name = 'CredentialDocumentFetchError';
    this.failure = failure;
  }
}

export type FetchCredentialDocumentOptions = {
  /** Defaults to {@link getMaxCredentialSize}. */
  maxBytes?: number;
  /** Defaults to {@link getFetchTimeoutMs}. */
  timeoutMs?: number;
};

/**
 * Fetches the document at `href`, a canonical WHATWG href the caller has
 * already validated as a well-formed http(s) URL without userinfo.
 *
 * @throws {CredentialDocumentFetchError} for every fetch outcome that is not a
 *   2xx body within the cap; the `failure` says which. Anything the resolver
 *   throws that is not one of its own error classes propagates untouched.
 */
export async function fetchCredentialDocument(
  href: string,
  options: FetchCredentialDocumentOptions = {},
): Promise<FetchedDocument> {
  const maxBytes = options.maxBytes ?? getMaxCredentialSize();
  const timeoutMs = options.timeoutMs ?? getFetchTimeoutMs();
  try {
    const resolved = await resolveDocument(href, {
      maxResponseBytes: maxBytes,
      totalTimeoutMs: timeoutMs,
      ...(allowsPrivateUrls() ? { allowPrivateAddresses: true } : {}),
    });
    // The resolver returns a 304 with an empty body rather than throwing,
    // for callers that sent conditional headers. This one never does, so a
    // 304 is a status the document did not come with, like any other.
    if (resolved.status < 200 || resolved.status >= 300) {
      throw new CredentialDocumentFetchError({
        kind: 'failed',
        reason: 'http',
        status: resolved.status,
        error: new Error(`${resolved.finalUrl} returned status ${resolved.status}.`),
      });
    }
    return {
      bytes: resolved.body,
      finalUrl: resolved.finalUrl,
      ...(resolved.contentType !== undefined ? { contentType: resolved.contentType } : {}),
    };
  } catch (error) {
    const failure = classifyResolverError(error);
    if (failure === undefined) throw error;
    throw new CredentialDocumentFetchError(failure);
  }
}

/**
 * Order matters. Every guard error extends `UrlValidationError` and every
 * resolver error extends `ResolverError`, so the specific classes are tested
 * first and the two base classes catch whatever is left.
 */
function classifyResolverError(error: unknown): DocumentFetchFailure | undefined {
  if (error instanceof ResolutionFailedError || error instanceof ResolutionEmptyError) {
    // The guard reports a DNS failure as a URL-validation error, but nothing
    // about the request is wrong. The name did not resolve this time.
    return { kind: 'failed', reason: 'dns', error };
  }
  if (
    error instanceof UnsupportedSchemeError ||
    error instanceof PrivateHostnameError ||
    error instanceof PrivateAddressError
  ) {
    return { kind: 'rejected', reason: 'source-not-permitted', error };
  }
  // A malformed URL, and anything else the guard rejects it for.
  if (error instanceof UrlValidationError) {
    return { kind: 'rejected', reason: 'invalid-url', error };
  }
  if (error instanceof ResolverTimedOutError) {
    return { kind: 'failed', reason: 'timeout', error };
  }
  if (error instanceof ResolverHttpError) {
    return { kind: 'failed', reason: 'http', status: error.status, error };
  }
  if (error instanceof ResolverTooLargeError) {
    return { kind: 'failed', reason: 'too-large', error };
  }
  if (error instanceof ResolverTooManyRedirectsError || error instanceof ResolverRedirectMissingLocationError) {
    return { kind: 'failed', reason: 'redirects', error };
  }
  if (error instanceof ResolverError) {
    return { kind: 'failed', reason: 'network', error };
  }
  return undefined;
}

/**
 * The statuses a later attempt may plausibly turn into a document: the two
 * 4xx that ask the client to try again, and the 5xx that mean the server or
 * a proxy in front of it is temporarily unable to answer. Every other
 * status is a refusal, including the 5xx that say the server will never
 * serve the request as made (501, 505 and the like).
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}
