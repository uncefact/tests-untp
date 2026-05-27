import type { MultibaseDigest } from '../multibase-digest/index.js';
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
 * Discriminated return from {@link resolveDocumentIfChanged}.
 *
 * - `{ kind: 'unchanged' }`: the upstream confirmed the cache is fresh
 *   (either via a `304 Not Modified` or via a `200` whose body digest
 *   matched `cached.bodyDigest`).
 * - `{ kind: 'loaded'; result }`: the upstream returned fresh content;
 *   `result` is the new {@link LoadResult} the caller should store.
 */
export type ResolveDocumentIfChangedValue = { kind: 'unchanged' } | { kind: 'loaded'; result: LoadResult };

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
 *  3. Otherwise, the fresh {@link LoadResult} is returned under the
 *     `loaded` discriminator.
 *
 * Errors from the underlying {@link resolveDocument} propagate unchanged.
 */
export async function resolveDocumentIfChanged(
  url: string,
  cached: CachedResource,
  options?: ResolveDocumentOptions,
): Promise<ResolveDocumentIfChangedValue> {
  // HTTP header names are case-insensitive on the wire, but a plain
  // `Record<string, string>` is not: a caller-supplied `'if-none-match'`
  // and our `'If-None-Match'` would survive as two distinct keys and
  // undici would emit both. Normalise every key to lower-case so the
  // cached validator wins cleanly.
  const conditionalHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    conditionalHeaders[key.toLowerCase()] = value;
  }
  if (cached.etag) conditionalHeaders['if-none-match'] = cached.etag;
  if (cached.lastModifiedHeader) conditionalHeaders['if-modified-since'] = cached.lastModifiedHeader;

  const result = await resolveDocument(url, { ...options, headers: conditionalHeaders });

  if (result.status === 304) {
    return { kind: 'unchanged' };
  }

  if (cached.bodyDigest && result.bodyDigest.toString() === cached.bodyDigest.toString()) {
    return { kind: 'unchanged' };
  }

  return { kind: 'loaded', result };
}
