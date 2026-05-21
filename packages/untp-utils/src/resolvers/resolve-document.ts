import { ReadableStream } from 'node:stream/web';
import { Agent, fetch as undiciFetch } from 'undici';
import { MultibaseDigest, type HashAlgorithm, type MultibaseEncoding } from '../multibase-digest/index.js';
import { validatePublicUrl } from '../node/index.js';
import type { ParseOutcome, ValidationError, ValidationWarning } from '../validation-outcome.js';
import { ResolverCode } from './codes.js';

/**
 * Defaults applied by {@link resolveDocument} (and, via composition,
 * by {@link import('./resolve-document-if-changed.js').resolveDocumentIfChanged})
 * when the caller does not supply a value.
 */
export const RESOLVER_DEFAULTS = {
  /** Body-size cap in bytes; exceeding emits {@link ResolverCode.TooLarge}. */
  maxResponseBytes: 1_048_576, // 1 MiB
  /** Total request timeout in milliseconds (DNS + connect + TLS + first byte + body). */
  totalTimeoutMs: 10_000,
  /** Maximum additional hops after the initial request; exceeding emits {@link ResolverCode.TooManyRedirects}. */
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
 * Only an allowlisted subset of response headers is exposed (the ones we
 * know consumers need: `etag` and `last-modified` for the conditional-fetch
 * skip chain, `content-type` for body-type checks). Returning the entire
 * header set would persist arbitrary attacker-influenced bytes for no
 * reason; if a new header is genuinely required by a consumer, add a
 * named field for it here rather than re-introducing a catch-all.
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
  /** The response's `ETag` header if present. Echoed into the next `CachedResource.etag`. */
  readonly etag?: string;
  /** The response's `Last-Modified` header if present. Echoed into the next `CachedResource.lastModifiedHeader`. */
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
  allowedSchemes?: readonly `${string}:`[];
}

/**
 * Outcome of {@link resolveDocument}, per ADR-034. `value` is present iff
 * `errors.length === 0`.
 *
 * @see ../../../docs/adrs/034-utils-error-and-warning-reporting.md
 */
export type ResolveDocumentOutcome = ParseOutcome<LoadResult>;

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
 * Per ADR-034, this function does not throw for input-related failures.
 * URL / scheme / hostname / DNS rejections from `validatePublicUrl`,
 * fetch-level errors, size-limit hits, redirect-cap hits, malformed
 * upstream `Location` headers, and HTTP error statuses all surface as
 * entries in the outcome's `errors[]`.
 *
 * @see https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 * @see ../../../docs/adrs/033-cvc-architecture.md
 * @see ../../../docs/adrs/034-utils-error-and-warning-reporting.md
 */
export async function resolveDocument(url: string, options?: ResolveDocumentOptions): Promise<ResolveDocumentOutcome> {
  const maxBytes = options?.maxResponseBytes ?? RESOLVER_DEFAULTS.maxResponseBytes;
  const totalTimeoutMs = options?.totalTimeoutMs ?? RESOLVER_DEFAULTS.totalTimeoutMs;
  const maxRedirects = options?.maxRedirects ?? RESOLVER_DEFAULTS.maxRedirects;

  const accumulatedWarnings: ValidationWarning[] = [];
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const validation = await validatePublicUrl(currentUrl, { allowedSchemes: options?.allowedSchemes });
      // Collect any advisory warnings even when validation passed, so the caller
      // sees every hop's warnings (e.g. near-private addresses) in the outcome.
      accumulatedWarnings.push(...validation.warnings);
      if (validation.errors.length > 0 || !validation.value) {
        return { errors: validation.errors, warnings: accumulatedWarnings };
      }

      const { address: pinnedAddress, family: pinnedFamily } = validation.value;
      let dispatcher: Agent;
      try {
        dispatcher = new Agent({
          connect: {
            // undici resolves the connect target with `all: true` to support
            // happy-eyeballs; the callback receives a `LookupAddress[]`. We
            // return a single-entry array containing the IP we pinned via
            // `validatePublicUrl`, so the connection target is exactly the
            // address that the SSRF check validated.
            lookup: (_hostname, _opts, cb) => cb(null, [{ address: pinnedAddress, family: pinnedFamily }]),
          },
        });
      } catch (error) {
        return outcomeWithError(
          {
            code: ResolverCode.NetworkError,
            message: `Failed to construct dispatcher for ${currentUrl}.`,
            received: currentUrl,
            raw: error,
          },
          accumulatedWarnings,
        );
      }

      // The entire request lifecycle (fetch + status-check + body read +
      // digest) must sit inside one try/finally with the dispatcher close:
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

        // 304 Not Modified is semantically distinct from a redirect: the body
        // is intentionally empty and the caller is expected to use its cached
        // copy. Return it without treating it as a redirect or as an error so
        // {@link import('./resolve-document-if-changed.js').resolveDocumentIfChanged}
        // can map it to `unchanged`.
        if (response.status === 304) {
          const headerView = extractHeaders(response.headers);
          const empty = new Uint8Array(0);
          const digest = await computeDigest(empty);
          if (digest.kind === 'error') {
            return outcomeWithError(digest.error, accumulatedWarnings);
          }
          return {
            value: {
              finalUrl: currentUrl,
              status: 304,
              body: empty,
              bodyDigest: digest.value,
              etag: headerView.etag,
              lastModified: headerView.lastModified,
              contentType: headerView.contentType,
            },
            errors: [],
            warnings: accumulatedWarnings,
          };
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            return outcomeWithError(
              {
                code: ResolverCode.RedirectMissingLocation,
                message: `Redirect response from ${currentUrl} had no Location header.`,
                received: response.status,
              },
              accumulatedWarnings,
            );
          }
          // Don't trust the upstream's Location header to be well-formed;
          // a malformed URL must surface as a structured error rather than
          // a thrown `TypeError` (ADR-034: never throw for input-related
          // failures, including upstream-supplied inputs).
          try {
            currentUrl = new URL(location, currentUrl).toString();
          } catch (error) {
            return outcomeWithError(
              {
                code: ResolverCode.RedirectMissingLocation,
                message: `Redirect Location header from ${currentUrl} is not a valid URL.`,
                received: location,
                raw: error,
              },
              accumulatedWarnings,
            );
          }
          // The 3xx body (if any) was discarded above by virtue of not being
          // read; cancel the stream so `dispatcher.close()` in `finally` can
          // proceed without waiting for body drain.
          if (response.body) await response.body.cancel().catch(() => undefined);
          continue;
        }

        if (!response.ok) {
          // Drain the body so the dispatcher's keep-alive close can proceed
          // without waiting for the unread error-response body.
          if (response.body) await response.body.cancel().catch(() => undefined);
          return outcomeWithError(
            {
              code: ResolverCode.HttpError,
              message: `Upstream returned HTTP ${response.status} for ${currentUrl}.`,
              received: response.status,
            },
            accumulatedWarnings,
          );
        }

        const readBody = await readWithLimit(response, maxBytes);
        if (readBody.kind === 'too-large') {
          return outcomeWithError(
            {
              code: ResolverCode.TooLarge,
              message: `Response body for ${currentUrl} exceeds ${maxBytes}-byte limit.`,
              received: maxBytes,
            },
            accumulatedWarnings,
          );
        }
        if (readBody.kind === 'error') {
          // An abort that fired during body read manifests here as a stream
          // error; classify as TimedOut so the operator sees the same code
          // they would if the timeout had fired pre-headers.
          const code = isAbortLikeError(readBody.error) ? ResolverCode.TimedOut : ResolverCode.NetworkError;
          return outcomeWithError(
            {
              code,
              message:
                code === ResolverCode.TimedOut
                  ? `Request to ${currentUrl} timed out after ${totalTimeoutMs}ms.`
                  : `Failed to read response body from ${currentUrl}.`,
              received: readBody.error instanceof Error ? readBody.error.message : String(readBody.error),
              raw: readBody.error,
            },
            accumulatedWarnings,
          );
        }

        const digest = await computeDigest(readBody.body);
        if (digest.kind === 'error') {
          return outcomeWithError(digest.error, accumulatedWarnings);
        }

        const headerView = extractHeaders(response.headers);
        const result: LoadResult = {
          finalUrl: currentUrl,
          status: response.status,
          body: readBody.body,
          bodyDigest: digest.value,
          etag: headerView.etag,
          lastModified: headerView.lastModified,
          contentType: headerView.contentType,
        };
        return { value: result, errors: [], warnings: accumulatedWarnings };
      } catch (error) {
        if (isAbortLikeError(error)) {
          return outcomeWithError(
            {
              code: ResolverCode.TimedOut,
              message: `Request to ${currentUrl} timed out after ${totalTimeoutMs}ms.`,
              received: currentUrl,
              raw: error,
            },
            accumulatedWarnings,
          );
        }
        return outcomeWithError(
          {
            code: ResolverCode.NetworkError,
            message: `Network error fetching ${currentUrl}.`,
            received: error instanceof Error ? error.message : String(error),
            raw: error,
          },
          accumulatedWarnings,
        );
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }

    return outcomeWithError(
      {
        code: ResolverCode.TooManyRedirects,
        message: `Exceeded ${maxRedirects} redirect hops starting from ${url}.`,
        received: maxRedirects,
      },
      accumulatedWarnings,
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function outcomeWithError(error: ValidationError, warnings: ValidationWarning[]): ResolveDocumentOutcome {
  return { errors: [error], warnings };
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
  const etag = headers.get('etag');
  if (etag) view.etag = etag;
  const lastModified = headers.get('last-modified');
  if (lastModified) view.lastModified = lastModified;
  const contentType = headers.get('content-type');
  if (contentType) view.contentType = contentType;
  return view;
}

type DigestResult = { kind: 'value'; value: MultibaseDigest } | { kind: 'error'; error: ValidationError };

async function computeDigest(body: Uint8Array): Promise<DigestResult> {
  try {
    const value = await MultibaseDigest.fromData(body, {
      algorithm: RESOLVER_DEFAULTS.digestAlgorithm,
      base: RESOLVER_DEFAULTS.digestEncoding,
    });
    return { kind: 'value', value };
  } catch (error) {
    return {
      kind: 'error',
      error: {
        code: ResolverCode.NetworkError,
        message: 'Failed to compute body digest.',
        received: error instanceof Error ? error.message : String(error),
        raw: error,
      },
    };
  }
}

type ReadBodyResult = { kind: 'ok'; body: Uint8Array } | { kind: 'too-large' } | { kind: 'error'; error: unknown };

async function readWithLimit(
  response: { body: ReadableStream<Uint8Array> | null },
  limit: number,
): Promise<ReadBodyResult> {
  if (!response.body) return { kind: 'ok', body: new Uint8Array(0) };

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
        return { kind: 'too-large' };
      }
      chunks.push(value);
    }
  } catch (error) {
    // Release the underlying response stream so the upstream socket can be
    // recycled; otherwise the reader holds the lock until GC and the
    // dispatcher's keep-alive pool leaks one slot per mid-stream failure.
    await reader.cancel().catch(() => undefined);
    return { kind: 'error', error };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', body: merged };
}
