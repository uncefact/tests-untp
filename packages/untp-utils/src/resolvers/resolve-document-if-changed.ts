import type { MultibaseDigest } from '../multibase-digest/index.js';
import type { ParseOutcome } from '../validation-outcome.js';
import { resolveDocument, type LoadResult, type ResolveDocumentOptions } from './resolve-document.js';

/**
 * Description of a previously-cached resource, used by
 * {@link resolveDocumentIfChanged} to drive the conditional-fetch skip
 * chain (`If-None-Match`, `If-Modified-Since`, body-digest comparison).
 */
export interface CachedResource {
  /** The `ETag` previously observed for this URL, if any. */
  etag?: string;
  /** The `Last-Modified` header previously observed, if any. */
  lastModifiedHeader?: string;
  /** The body digest of the previously cached response. */
  bodyDigest?: MultibaseDigest;
}

/**
 * Discriminated outcome value from {@link resolveDocumentIfChanged}.
 *
 * - `{ kind: 'unchanged' }`: the upstream confirmed the cache is fresh
 *   (either via a `304 Not Modified` or via a `200` whose body digest
 *   matched `cached.bodyDigest`).
 * - `{ kind: 'loaded'; result }`: the upstream returned fresh content;
 *   `result` is the new {@link LoadResult} the caller should store.
 */
export type ResolveDocumentIfChangedValue = { kind: 'unchanged' } | { kind: 'loaded'; result: LoadResult };

/**
 * Outcome of {@link resolveDocumentIfChanged}, per ADR-034. `value` is
 * present iff `errors.length === 0`.
 *
 * @see ../../../docs/adrs/034-utils-error-and-warning-reporting.md
 */
export type ResolveDocumentIfChangedOutcome = ParseOutcome<ResolveDocumentIfChangedValue>;

/**
 * Conditional-fetch wrapper around {@link resolveDocument} that implements
 * the skip chain from ADR-033 §1.
 *
 * Three short-circuits, in order:
 *
 *  1. **`304 Not Modified`** from the upstream (driven by `If-None-Match`
 *     and `If-Modified-Since` headers built from `cached.etag` and
 *     `cached.lastModifiedHeader`).
 *  2. **Body-digest match** after a `200 OK` (the upstream ignored the
 *     conditional headers but returned the same content; compared against
 *     `cached.bodyDigest`).
 *  3. Otherwise, the fresh {@link LoadResult} is returned as the new value
 *     under the `loaded` discriminator.
 *
 * Per ADR-034, this function does not throw for input-related failures;
 * any errors from the underlying resolve call propagate via `errors[]`.
 *
 * @see ../../../docs/adrs/033-cvc-architecture.md
 */
export async function resolveDocumentIfChanged(
  url: string,
  cached: CachedResource,
  options?: ResolveDocumentOptions,
): Promise<ResolveDocumentIfChangedOutcome> {
  // HTTP header names are case-insensitive on the wire, but a plain
  // `Record<string, string>` is not: a caller-supplied `'if-none-match'` and
  // our `'If-None-Match'` would survive as two distinct keys and undici
  // would emit both, producing a malformed conditional header. Normalise
  // every key to lower-case so the cached validator wins cleanly.
  const conditionalHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    conditionalHeaders[key.toLowerCase()] = value;
  }
  if (cached.etag) conditionalHeaders['if-none-match'] = cached.etag;
  if (cached.lastModifiedHeader) conditionalHeaders['if-modified-since'] = cached.lastModifiedHeader;

  const outcome = await resolveDocument(url, { ...options, headers: conditionalHeaders });
  if (outcome.errors.length > 0 || !outcome.value) {
    return { errors: outcome.errors, warnings: outcome.warnings };
  }

  if (outcome.value.status === 304) {
    return { value: { kind: 'unchanged' }, errors: [], warnings: outcome.warnings };
  }

  if (cached.bodyDigest && safeMultibaseEquals(outcome.value.bodyDigest, cached.bodyDigest)) {
    return { value: { kind: 'unchanged' }, errors: [], warnings: outcome.warnings };
  }

  return { value: { kind: 'loaded', result: outcome.value }, errors: [], warnings: outcome.warnings };
}

/**
 * Compares two {@link MultibaseDigest} values by their canonical multibase
 * string. Treats any throw from a malformed/partially-constructed cached
 * digest as "does not match" rather than letting the exception escape; the
 * caller still gets the fresh {@link LoadResult} as the new value.
 */
function safeMultibaseEquals(a: MultibaseDigest, b: MultibaseDigest): boolean {
  try {
    return a.toString() === b.toString();
  } catch {
    return false;
  }
}
