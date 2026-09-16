/**
 * Fetches verifier-supplied HTTPS documents through the shared resolver. The
 * resolver validates and pins every redirect hop, and one 10-second budget
 * covers DNS, redirects, transport and body reading. Private-address details
 * stay in server logs and are not included in the response.
 *
 * @see https://github.com/uncefact/tests-untp/issues/825
 * @see ../../../../../../docs/adrs/035-utils-throws-structured-errors.md
 */
import { NextResponse } from 'next/server';
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
  ResolverError,
  ResolverHttpError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
  resolveDocument,
  type LoadResult,
} from '@uncefact/untp-utils/resolvers';

export const runtime = 'nodejs';

const MAX_RESPONSE_BYTES = 10 * 1_048_576;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

type FetchError = 'invalid-url' | 'blocked' | 'not-found' | 'timeout' | 'too-large' | 'too-many-redirects' | 'network';

type FetchResponse =
  | { ok: true; body: string; contentType: string | null; finalUrl: string }
  | { ok: false; error: FetchError; message: string };

/**
 * Closed, server-validated Accept selector (#811, #817). Callers name a profile; the server owns
 * the header string. A caller-supplied Accept header would open a request-header surface the SSRF
 * guard was not designed for, so unknown selector values are rejected rather than passed through.
 */
const ACCEPT_PROFILES = {
  json: 'application/json, application/ld+json, */*;q=0.1',
  linkset: 'application/linkset+json, application/json;q=0.5, */*;q=0.1',
} as const;

type AcceptProfile = keyof typeof ACCEPT_PROFILES;

type FetchRequestBody = {
  url?: unknown;
  accept?: unknown;
};

export async function POST(request: Request): Promise<NextResponse<FetchResponse>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid-url', message: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  if (!isFetchRequestBody(parsed) || typeof parsed.url !== 'string' || parsed.url.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid-url', message: 'Missing "url" string in body.' },
      { status: 400 },
    );
  }

  const accept = parsed.accept === undefined ? 'json' : parsed.accept;
  if (!isAcceptProfile(accept)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid-url',
        message: `Unknown "accept" selector. Allowed values: ${Object.keys(ACCEPT_PROFILES).join(', ')}.`,
      },
      { status: 400 },
    );
  }

  // Everything after the resolver call stays inside the try. An unexpected throw from URL
  // normalisation or the decode is then mapped to the closed union's network row instead of
  // escaping as a framework 500 outside the response contract.
  try {
    const result: LoadResult = await resolveDocument(parsed.url, {
      allowedSchemes: ['https'],
      maxResponseBytes: MAX_RESPONSE_BYTES,
      totalTimeoutMs: REQUEST_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      headers: { Accept: ACCEPT_PROFILES[accept] },
    });

    const finalUrl = new URL(result.finalUrl).toString();
    if (result.status === 304) {
      console.error('Fetch route failed', { className: 'NotModified', status: 304, finalUrl });
      const response: FetchResponse = {
        ok: false,
        error: 'network',
        message: `Upstream returned 304 for ${finalUrl}.`,
      };
      return NextResponse.json(response, { status: statusForError(response.error) });
    }

    const response: FetchResponse = {
      ok: true,
      body: new TextDecoder('utf-8').decode(result.body),
      contentType: result.contentType ?? null,
      finalUrl,
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const mapped = mapFetchError(error, parsed.url);
    return NextResponse.json(mapped, { status: statusForError(mapped.error) });
  }
}

function isFetchRequestBody(value: unknown): value is FetchRequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Object.hasOwn, not `in`: prototype names ('toString', '__proto__') must 400 like any other
 * unknown selector, before any DNS lookup or fetch.
 */
function isAcceptProfile(value: unknown): value is AcceptProfile {
  return typeof value === 'string' && Object.hasOwn(ACCEPT_PROFILES, value);
}

function mapFetchError(error: unknown, inputUrl: string): Exclude<FetchResponse, { ok: true }> {
  logFetchError(error);

  if (error instanceof InvalidUrlError) {
    return { ok: false, error: 'invalid-url', message: `Not a valid URL: ${inputUrl}` };
  }
  if (error instanceof UnsupportedSchemeError) {
    return {
      ok: false,
      error: 'blocked',
      message: `Only https: URLs are allowed (got ${stringReceived(error, 'unknown')}:).`,
    };
  }
  if (error instanceof PrivateHostnameError) {
    return {
      ok: false,
      error: 'blocked',
      message: `Hostname ${stringReceived(error, '(empty)')} is in a blocked range.`,
    };
  }
  if (error instanceof PrivateAddressError) {
    return { ok: false, error: 'blocked', message: error.message };
  }
  if (error instanceof ResolutionFailedError || error instanceof ResolutionEmptyError) {
    return { ok: false, error: 'network', message: error.message };
  }
  if (error instanceof UrlValidationError) {
    return { ok: false, error: 'invalid-url', message: `Not a valid URL: ${inputUrl}` };
  }
  if (error instanceof ResolverHttpError) {
    const responseError: FetchError = error.status === 404 ? 'not-found' : 'network';
    return {
      ok: false,
      error: responseError,
      message: `Upstream returned ${error.status} for ${error.url}.`,
    };
  }
  if (error instanceof ResolverTooLargeError) {
    return { ok: false, error: 'too-large', message: `Response exceeds ${error.limit} byte limit.` };
  }
  if (error instanceof ResolverTooManyRedirectsError) {
    return { ok: false, error: 'too-many-redirects', message: `Exceeded ${error.limit} redirect hops.` };
  }
  if (error instanceof ResolverTimedOutError) {
    return {
      ok: false,
      error: 'timeout',
      message: `Request to ${inputUrl} timed out after ${error.timeoutMs}ms (including redirects).`,
    };
  }
  if (error instanceof ResolverRedirectMissingLocationError) {
    return { ok: false, error: 'network', message: error.message };
  }
  // ResolverNetworkError and every remaining ResolverError subclass share this row.
  if (error instanceof ResolverError) {
    return { ok: false, error: 'network', message: `Could not fetch ${inputUrl}.` };
  }
  return { ok: false, error: 'network', message: 'Unknown network error.' };
}

function stringReceived(error: UrlValidationError, fallback: string): string {
  return typeof error.received === 'string' ? error.received : fallback;
}

function logFetchError(error: unknown): void {
  if (error instanceof Error) {
    const details: { className: string; code: unknown; resolvedAddresses?: readonly string[] } = {
      className: error.constructor.name,
      code: 'code' in error ? (error as { code?: unknown }).code : undefined,
    };
    if (error instanceof PrivateAddressError) details.resolvedAddresses = error.resolvedAddresses;
    console.error('Fetch route failed', { ...details, error });
    return;
  }
  console.error('Fetch route failed', { className: typeof error, code: undefined, error });
}

function statusForError(error: FetchError): number {
  switch (error) {
    case 'invalid-url':
      return 400;
    case 'blocked':
      return 400;
    case 'not-found':
      return 404;
    case 'timeout':
      return 504;
    case 'too-large':
      return 413;
    case 'too-many-redirects':
      return 502;
    case 'network':
      return 502;
  }
}
