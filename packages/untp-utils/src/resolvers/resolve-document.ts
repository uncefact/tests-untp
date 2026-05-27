import { ReadableStream } from 'node:stream/web';
import { Agent, fetch as undiciFetch } from 'undici';
import { parseEntityTag, parseImfDate, parseMediaType } from '../http-headers/index.js';
import { MultibaseDigest, type HashAlgorithm, type MultibaseEncoding } from '../multibase-digest/index.js';
import { validatePublicUrl } from '../node/index.js';
import {
  ResolverHttpError,
  ResolverNetworkError,
  ResolverRedirectMissingLocationError,
  ResolverTimedOutError,
  ResolverTooLargeError,
  ResolverTooManyRedirectsError,
} from './errors.js';

/**
 * Defaults applied by {@link resolveDocument} (and, via composition,
 * by {@link import('./resolve-document-if-changed.js').resolveDocumentIfChanged})
 * when the caller does not supply a value.
 */
export const RESOLVER_DEFAULTS = {
  /** Body-size cap in bytes; exceeding throws {@link ResolverTooLargeError}. */
  maxResponseBytes: 1_048_576,
  /** Total request timeout in milliseconds (DNS + connect + TLS + first byte + body). */
  totalTimeoutMs: 10_000,
  /** Maximum additional hops after the initial request; exceeding throws {@link ResolverTooManyRedirectsError}. */
  maxRedirects: 3,
  /** Multibase digest algorithm used to hash response bodies. */
  digestAlgorithm: 'sha2-256',
  /** Multibase encoding used for response body digests. */
  digestEncoding: 'base58btc',
} as const satisfies {
  maxResponseBytes: number;
  totalTimeoutMs: number;
  maxRedirects: number;
  digestAlgorithm: HashAlgorithm;
  digestEncoding: MultibaseEncoding;
};

/**
 * Result of a fetch that produced a final response (any non-redirect status,
 * including `304 Not Modified`).
 *
 * Only an allowlisted subset of response headers is exposed (the ones
 * downstream consumers need: `etag` and `last-modified` for the conditional-
 * fetch skip chain, `content-type` for body-type checks).
 *
 * All fields are `readonly`: a `LoadResult` is a frozen snapshot of one
 * fetch and must not be mutated by consumers.
 */
export interface LoadResult {
  /** Final URL after redirect chasing (matches `url` when there were no redirects). */
  readonly finalUrl: string;
  /** HTTP status code of the final response (the redirect chain terminator, or `304`). */
  readonly status: number;
  /** Raw response body bytes. */
  readonly body: Uint8Array;
  /** Multibase digest of {@link body} (algorithm/encoding per {@link RESOLVER_DEFAULTS}). */
  readonly bodyDigest: MultibaseDigest;
  /** The response's `ETag` header if present. */
  readonly etag?: string;
  /** The response's `Last-Modified` header if present. */
  readonly lastModified?: string;
  /** The response's `Content-Type` header if present. */
  readonly contentType?: string;
}

/**
 * Options accepted by {@link resolveDocument} and
 * {@link import('./resolve-document-if-changed.js').resolveDocumentIfChanged}.
 *
 * Header keys are case-insensitive on the wire; `resolveDocumentIfChanged`
 * lowercases all keys before merging and reserves `if-none-match` /
 * `if-modified-since` for its conditional-fetch wiring.
 */
export interface ResolveDocumentOptions {
  /** Override {@link RESOLVER_DEFAULTS.maxResponseBytes}. */
  maxResponseBytes?: number;
  /** Override {@link RESOLVER_DEFAULTS.totalTimeoutMs}. */
  totalTimeoutMs?: number;
  /** Override {@link RESOLVER_DEFAULTS.maxRedirects}. */
  maxRedirects?: number;
  /** Additional headers to send with the request (e.g. `Accept`). */
  headers?: Record<string, string>;
  /** Allowed URL schemes (forwarded to {@link import('../node/index.js').validatePublicUrl}). */
  allowedSchemes?: readonly string[];
}

/**
 * Fetches `url` with the standard SSRF / size / timeout / redirect guards
 * applied, returning the response body + metadata as a {@link LoadResult}.
 *
 * Each redirect hop is re-validated through
 * {@link import('../node/index.js').validatePublicUrl}, and the connection
 * to each hop is pinned to the IP that validation resolved, so an upstream
 * cannot redirect to a private URL or rebind its hostname between check
 * and connect.
 *
 * @throws {UrlValidationError} for URL / scheme / hostname / DNS / private-address rejections from `validatePublicUrl`.
 * @throws {ResolverNetworkError} when fetch rejects before producing a response.
 * @throws {ResolverHttpError} on a non-2xx response status (with `.status`).
 * @throws {ResolverTooLargeError} when the body exceeds the size cap (with `.limit`).
 * @throws {ResolverTooManyRedirectsError} when the redirect chain exceeds the hop cap (with `.limit`).
 * @throws {ResolverTimedOutError} when the total timeout fires (with `.timeoutMs`).
 * @throws {ResolverRedirectMissingLocationError} for a 3xx with no / unparseable Location header.
 *
 * @see https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 */
export async function resolveDocument(url: string, options?: ResolveDocumentOptions): Promise<LoadResult> {
  const maxBytes = options?.maxResponseBytes ?? RESOLVER_DEFAULTS.maxResponseBytes;
  const totalTimeoutMs = options?.totalTimeoutMs ?? RESOLVER_DEFAULTS.totalTimeoutMs;
  const maxRedirects = options?.maxRedirects ?? RESOLVER_DEFAULTS.maxRedirects;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const { address: pinnedAddress, family: pinnedFamily } = await validatePublicUrl(currentUrl, {
        allowedSchemes: options?.allowedSchemes,
      });

      const dispatcher = new Agent({
        connect: {
          // undici resolves the connect target with `all: true` to support
          // happy-eyeballs; the callback receives a `LookupAddress[]`.
          // Return a single-entry array containing the IP we pinned via
          // `validatePublicUrl`, so the connection target is exactly the
          // address that the SSRF check validated.
          lookup: (_hostname, _opts, cb) => cb(null, [{ address: pinnedAddress, family: pinnedFamily }]),
        },
      });

      // The entire request lifecycle (fetch + status-check + body read +
      // digest) sits inside one try/finally with the dispatcher close:
      // `undici.Agent.close()` waits for active requests to drain, and a
      // request is "drained" only once its body has been consumed. Closing
      // before `readWithLimit` deadlocks the close on the unconsumed body.
      try {
        const response = await undiciFetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: options?.headers,
          dispatcher,
        });

        // 304 Not Modified: body is intentionally empty; the caller maps it
        // to `unchanged` in `resolveDocumentIfChanged`.
        if (response.status === 304) {
          const headerView = extractHeaders(response.headers);
          const empty = new Uint8Array(0);
          const bodyDigest = await computeDigest(empty);
          return {
            finalUrl: currentUrl,
            status: 304,
            body: empty,
            bodyDigest,
            etag: headerView.etag,
            lastModified: headerView.lastModified,
            contentType: headerView.contentType,
          };
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new ResolverRedirectMissingLocationError(currentUrl, response.status);
          }
          let nextUrl: string;
          try {
            nextUrl = new URL(location, currentUrl).toString();
          } catch (cause) {
            throw new ResolverRedirectMissingLocationError(currentUrl, location, cause);
          }
          // Cancel the 3xx body so `dispatcher.close()` in `finally` can
          // proceed without waiting for body drain.
          if (response.body) await response.body.cancel().catch(() => undefined);
          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          if (response.body) await response.body.cancel().catch(() => undefined);
          throw new ResolverHttpError(currentUrl, response.status);
        }

        const body = await readWithLimit(response, maxBytes, currentUrl, totalTimeoutMs);
        const bodyDigest = await computeDigest(body);
        const headerView = extractHeaders(response.headers);
        return {
          finalUrl: currentUrl,
          status: response.status,
          body,
          bodyDigest,
          etag: headerView.etag,
          lastModified: headerView.lastModified,
          contentType: headerView.contentType,
        };
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }

    throw new ResolverTooManyRedirectsError(url, maxRedirects);
  } catch (cause) {
    if (cause instanceof Error && (cause as Error & { code?: string }).code?.startsWith('resolver.')) {
      throw cause;
    }
    // Re-throw UrlValidationErrors and other StructuredErrors unwrapped.
    if (
      cause instanceof Error &&
      typeof (cause as Error & { code?: unknown }).code === 'string' &&
      ((cause as Error & { code: string }).code.startsWith('url.') ||
        (cause as Error & { code: string }).code.startsWith('resolver.'))
    ) {
      throw cause;
    }
    if (isAbortLikeError(cause)) {
      throw new ResolverTimedOutError(url, totalTimeoutMs, cause);
    }
    throw new ResolverNetworkError(url, cause);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

interface HeaderView {
  etag?: string;
  lastModified?: string;
  contentType?: string;
}

function extractHeaders(headers: Headers): HeaderView {
  const view: HeaderView = {};
  const etag = parseEntityTag(headers.get('etag') ?? '');
  if (etag !== undefined) view.etag = etag;
  const lastModified = parseImfDate(headers.get('last-modified') ?? '');
  if (lastModified !== undefined) view.lastModified = lastModified;
  const contentType = parseMediaType(headers.get('content-type') ?? '');
  if (contentType !== undefined) view.contentType = contentType;
  return view;
}

async function computeDigest(body: Uint8Array): Promise<MultibaseDigest> {
  return MultibaseDigest.fromData(body, {
    algorithm: RESOLVER_DEFAULTS.digestAlgorithm,
    base: RESOLVER_DEFAULTS.digestEncoding,
  });
}

async function readWithLimit(
  response: { body: ReadableStream<Uint8Array> | null },
  limit: number,
  url: string,
  totalTimeoutMs: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ResolverTooLargeError(url, limit);
      }
      chunks.push(value);
    }
  } catch (error) {
    // Release the reader so the upstream socket can be recycled.
    await reader.cancel().catch(() => undefined);
    if (error instanceof ResolverTooLargeError) throw error;
    if (isAbortLikeError(error)) throw new ResolverTimedOutError(url, totalTimeoutMs, error);
    throw new ResolverNetworkError(url, error);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
