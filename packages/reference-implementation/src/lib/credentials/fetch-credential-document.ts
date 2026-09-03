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

/**
 * The one fetch for a caller-supplied credential URL (#955). It runs the
 * guarded resolver by default and a plain fetch when
 * `VERIFY_ALLOW_PRIVATE_URLS=true` relaxes it for local development. It
 * returns bytes and reports failures as typed facts. Each route maps those
 * facts to its own responses, so a route that reads a DNS failure or a 404
 * differently from the verify route does not need a second fetch.
 */

const DEFAULT_MAX_CREDENTIAL_SIZE = 10_485_760; // 10 MB
const DEFAULT_TIMEOUT_MS = 10_000;

/** The response-size cap in bytes, from `VERIFY_MAX_CREDENTIAL_SIZE` when set and positive. */
export function getMaxCredentialSize(): number {
  const envVal = process.env.VERIFY_MAX_CREDENTIAL_SIZE;
  if (!envVal) return DEFAULT_MAX_CREDENTIAL_SIZE;
  const parsed = parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CREDENTIAL_SIZE;
}

/** Whether the development bypass is on. When it is, every href is fetched with a plain fetch and the SSRF guard never runs. */
function allowsPrivateUrls(): boolean {
  return process.env.VERIFY_ALLOW_PRIVATE_URLS === 'true';
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
 */
export type DocumentFetchFailure =
  | { kind: 'rejected'; reason: 'invalid-url' | 'source-not-permitted'; error: Error }
  | { kind: 'failed'; reason: 'http'; status: number; error: Error }
  | {
      kind: 'failed';
      reason: 'too-large';
      /** The bytes actually read, known only when the whole body was buffered before the cap was applied. */
      observedBytes?: number;
      error: Error;
    }
  | { kind: 'failed'; reason: 'dns' | 'network' | 'timeout' | 'redirects' | 'body-unreadable'; error: Error };

/**
 * Whether the same request may plausibly succeed later. This says nothing
 * about whose fault the failure was. A DNS fault is retryable and the verify
 * route still answers it as the caller's 400, because that is what the route
 * has always done.
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
  /** Defaults to 10 seconds. */
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (allowsPrivateUrls()) {
    return plainFetch(href, maxBytes, timeoutMs);
  }
  try {
    const resolved = await resolveDocument(href, { maxResponseBytes: maxBytes, totalTimeoutMs: timeoutMs });
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

/**
 * Reads the fault behind a plain-fetch rejection. Node's fetch rejects with
 * a TypeError whose `cause` carries the system error, so a name that did not
 * resolve and a redirect chain that ran out are told apart here, as the
 * guarded resolver tells them apart with its own classes.
 */
function classifyPlainFetchRejection(error: Error): 'dns' | 'timeout' | 'redirects' | 'network' {
  if (error.name === 'TimeoutError') return 'timeout';
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  const message = typeof cause?.message === 'string' ? cause.message : '';
  if (/redirect/i.test(message)) return 'redirects';
  return 'network';
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function plainFetch(href: string, maxBytes: number, timeoutMs: number): Promise<FetchedDocument> {
  let response: Response;
  try {
    response = await fetch(href, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const cause = toError(error);
    throw new CredentialDocumentFetchError({
      kind: 'failed',
      reason: classifyPlainFetchRejection(cause),
      error: cause,
    });
  }

  if (!response.ok) {
    throw new CredentialDocumentFetchError({
      kind: 'failed',
      reason: 'http',
      status: response.status,
      error: new Error(`${href} returned status ${response.status}.`),
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new CredentialDocumentFetchError({ kind: 'failed', reason: 'body-unreadable', error: toError(error) });
  }

  if (bytes.byteLength > maxBytes) {
    throw new CredentialDocumentFetchError({
      kind: 'failed',
      reason: 'too-large',
      observedBytes: bytes.byteLength,
      error: new Error(`Response body for ${href} exceeds ${maxBytes}-byte limit.`),
    });
  }

  const contentType = response.headers.get('content-type');
  return { bytes, finalUrl: response.url || href, ...(contentType ? { contentType } : {}) };
}
