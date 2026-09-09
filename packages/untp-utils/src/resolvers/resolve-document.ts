import { ReadableStream } from 'node:stream/web';
import {
  parseEntityTag,
  parseImfDate,
  parseMediaType,
  DEFAULT_USER_AGENT,
  USER_AGENT_ENV_VAR,
  isValidHttpUserAgent,
} from '../http-headers/index.js';
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
  /** Total wait for asynchronous DNS and fetch work in milliseconds. Synchronous work cannot be interrupted, and DNS itself is not cancelled. */
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
 * Merges the resolved `User-Agent` into the caller's headers. A caller-supplied
 * `user-agent` (any casing) wins; otherwise the `RI_HTTP_USER_AGENT` env
 * override (blank treated as unset), then the default. Both branches copy the
 * caller's headers before request conversion, so a throwing getter remains a
 * caller defect rather than becoming a transport failure. The override is not
 * validated here: deployments validate it at boot via
 * {@link isValidHttpUserAgent} (the RI does, in instrumentation.node.ts),
 * and a value that slips through with control characters makes the fetch
 * itself fail loudly rather than being silently replaced.
 */
function withUserAgent(headers: Record<string, string> | undefined): Record<string, string> {
  const hasExplicit = Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'user-agent');
  if (hasExplicit) return { ...(headers ?? {}) };
  const fromEnv = process.env[USER_AGENT_ENV_VAR];
  const userAgent = fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : DEFAULT_USER_AGENT;
  return { ...headers, 'User-Agent': userAgent };
}

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
  /** Permit private and reserved destinations while retaining every other guard. */
  allowPrivateAddresses?: boolean;
}

/**
 * Fetches `url` with the standard SSRF / size / timeout / redirect guards
 * applied, returning the response body + metadata as a {@link LoadResult}.
 *
 * Each redirect hop is re-validated through
 * {@link import('../node/index.js').validatePublicUrl}, and the connection to
 * each hop is pinned to the addresses its validation resolved, tried in
 * resolver order, so an upstream cannot rebind its hostname between check and
 * connect. Private and reserved
 * destinations remain rejected unless `allowPrivateAddresses` is exactly true.
 *
 * Only two awaits convert a foreign rejection into a resolver error: the undici
 * fetch and the body read. Every other throw inside this function, whether a
 * guard error or a defect in this module, propagates exactly as thrown. That
 * is the contract #995 settled, and it is why `verify-did-web.ts:104` now
 * surfaces a resolver defect to its caller instead of reporting it as a
 * retryable network fault.
 *
 * @throws {UrlValidationError} for URL / scheme / hostname / DNS / private-address rejections from `validatePublicUrl`, propagated unwrapped.
 * @throws {ResolverNetworkError} when the fetch rejects before producing a response, or when a mid-body read rejects, and the rejection was not classified as this request's timeout; a non-abort-shaped rejection arriving after the deadline is also reported here.
 * @throws {ResolverHttpError} on a non-2xx response status (with `.status`).
 * @throws {ResolverTooLargeError} when the body exceeds the size cap (with `.limit`).
 * @throws {ResolverTooManyRedirectsError} when the redirect chain exceeds the hop cap (with `.limit`, and `.lastHopUrl` for the hop that answered the exhausting redirect).
 * @throws {ResolverTimedOutError} before a hop or while the guard was waiting on DNS, once the deadline has passed; in flight or mid-body, when this request's abort is what the failing call observed (with `.timeoutMs`).
 * @throws {ResolverRedirectMissingLocationError} for a 3xx with no / unparseable Location header.
 *
 * @see https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 */
export async function resolveDocument(url: string, options?: ResolveDocumentOptions): Promise<LoadResult> {
  // Dynamic import: undici's module initialisation needs web globals
  // (TextDecoder) that jsdom test environments lack, so it loads at fetch
  // time to keep this module, and the resolvers barrel, importable there.
  // Same pattern as validate-jsonld.ts's lazy jsonld import.
  const { Agent, fetch: undiciFetch } = await import('undici');
  const maxBytes = options?.maxResponseBytes ?? RESOLVER_DEFAULTS.maxResponseBytes;
  const totalTimeoutMs = options?.totalTimeoutMs ?? RESOLVER_DEFAULTS.totalTimeoutMs;
  const maxRedirects = options?.maxRedirects ?? RESOLVER_DEFAULTS.maxRedirects;

  // The deadline protocol. `currentUrl` is hoisted above the abort promise so
  // the promise, created once per request rather than once per hop, rejects
  // with whichever hop was in flight when the timer fired: a timeout during
  // DNS then names the host it was waiting on. Racing the guard against that
  // promise bounds the wait without cancelling the lookup, because
  // `dns.lookup` takes no signal. The bare promises are raced so that a
  // rejection from whichever settles first still reaches the caller; the two
  // `void ... .catch(...)` side channels exist only to keep the loser's
  // rejection from surfacing as an unhandled rejection, and must not be moved
  // into the race, where they would resolve the race with `undefined` and
  // swallow a DNS failure. `signal.aborted` is checked before the guard is
  // invoked, so a hop whose predecessor's cleanup consumed the budget makes no
  // further guard call, and again after the race, so nothing is dispatched
  // once the budget is spent. No `await` may be inserted between that second
  // check and `new Agent`: any suspension there reopens the window in which
  // the timer fires and an Agent is still constructed. Tests enforce all of
  // this (no second-hop guard call, no Agent, fetch never called), not types.
  let currentUrl = url;
  const controller = new AbortController();
  let removeAbortListener: () => void = () => undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new ResolverTimedOutError(currentUrl, totalTimeoutMs));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort);
  });
  void abortPromise.catch(() => undefined);
  const timeoutHandle = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (controller.signal.aborted) throw new ResolverTimedOutError(currentUrl, totalTimeoutMs);

      const guard = validatePublicUrl(currentUrl, {
        allowedSchemes: options?.allowedSchemes,
        allowPrivateAddresses: options?.allowPrivateAddresses,
      });
      void guard.catch(() => undefined);
      const { addresses: pinnedAddresses } = await Promise.race([guard, abortPromise]);

      if (controller.signal.aborted) throw new ResolverTimedOutError(currentUrl, totalTimeoutMs);

      const dispatcher = new Agent({
        connect: {
          // undici resolves the connect target with `all: true` to support
          // happy-eyeballs; the callback receives a `LookupAddress[]`. Return
          // every address `validatePublicUrl` validated, in resolver order, so
          // the connector performs no lookup of its own and each address it
          // may try is one the SSRF check passed. Handing it only the first
          // would refuse a name whose other addresses hold the listener:
          // `localhost` resolves to both `::1` and `127.0.0.1`, and Node's
          // default `autoSelectFamily` is what tries the second when the first
          // is refused.
          lookup: (_hostname, _opts, cb) =>
            cb(
              null,
              pinnedAddresses.map(({ address, family }) => ({ address, family })),
            ),
        },
      });

      // The entire request lifecycle (fetch + status-check + body read +
      // digest) sits inside one try/finally with the dispatcher close:
      // `undici.Agent.close()` waits for active requests to drain, and a
      // request is "drained" only once its body has been consumed. Closing
      // before `readWithLimit` deadlocks the close on the unconsumed body.
      try {
        const headers = withUserAgent(options?.headers);
        const requestOptions = {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers,
          dispatcher,
        } as const;

        let response: Awaited<ReturnType<typeof undiciFetch>>;
        try {
          response = await undiciFetch(currentUrl, requestOptions);
        } catch (cause) {
          // This catch also sees undici's Request-construction rejections, so a
          // redirect hop carrying userinfo or a malformed header value is
          // wrapped as a network error rather than propagating as a defect.
          // That is the recorded exception to #995's wording.
          if (isOurTimeout(cause, controller.signal)) {
            throw new ResolverTimedOutError(currentUrl, totalTimeoutMs, cause);
          }
          throw new ResolverNetworkError(currentUrl, cause);
        }

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
          if (hop === maxRedirects) {
            throw new ResolverTooManyRedirectsError(url, maxRedirects, currentUrl);
          }
          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          if (response.body) await response.body.cancel().catch(() => undefined);
          throw new ResolverHttpError(currentUrl, response.status);
        }

        const body = await readWithLimit(response, maxBytes, currentUrl, totalTimeoutMs, controller.signal);
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
  } finally {
    clearTimeout(timeoutHandle);
    removeAbortListener();
  }
}

/**
 * The classification policy at the two transport catches: a rejection counts as
 * this request's timeout only when this request's signal has fired and the
 * error is named `AbortError` or `TimeoutError`. Everything else caught there
 * becomes a {@link ResolverNetworkError}.
 *
 * The signal gate stops an abort-shaped rejection counting as this request's
 * timeout while its signal is quiet, which would tell the operator "timed out
 * after 10000ms" when 300 ms elapsed. The name gate keeps a non-abort-shaped
 * rejection arriving after the deadline classified as a network fault. Neither
 * gate proves the rejection was caused by this signal; this is the chosen
 * policy, not a proof of cause.
 */
function isOurTimeout(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && isAbortLikeError(error);
}

function isAbortLikeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
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
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let readResult: Awaited<ReturnType<typeof reader.read>>;
      try {
        readResult = await reader.read();
      } catch (error) {
        if (isOurTimeout(error, signal)) throw new ResolverTimedOutError(url, totalTimeoutMs, error);
        throw new ResolverNetworkError(url, error);
      }

      const { value, done } = readResult;
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        throw new ResolverTooLargeError(url, limit);
      }
      chunks.push(value);
    }
  } catch (error) {
    // Cleanup only: release the reader so the upstream socket can be
    // recycled, then rethrow the original value unchanged. Classification
    // happens at the read await above, and the over-cap error is raised
    // without cancelling inline precisely so cancellation stays here. A
    // future edit that classified or replaced the error here would relabel
    // both a defect and an already-classified resolver error.
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
