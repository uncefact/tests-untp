import type { TtlCache } from '../cache/ttl-cache.js';
import { ResolverHttpError, ResolverInvalidJsonError, ResolverNetworkError } from '../resolvers/errors.js';
import { SchemaLoaderHttpError, SchemaLoaderInvalidJsonError, SchemaLoaderNetworkError } from './errors.js';

/**
 * Loads a JSON Schema document by URL. `T` declares the shape the caller
 * expects the fetched schema to have; the loader asserts the parsed JSON to
 * `T` without runtime validation, so a mismatch surfaces downstream (for
 * schemas, at Ajv compile time).
 */
export interface SchemaLoader<T extends object = object> {
  load(url: string): Promise<T>;
}

const FETCH_TIMEOUT_MS = 10_000;
const SCHEMA_ACCEPT = 'application/schema+json, application/json;q=0.9';

/**
 * Maps the guarded resolver's typed errors onto this package's public error
 * contract. HTTP-status and invalid-JSON failures keep their dedicated types.
 * The two failure modes that predate the guarded resolver (plain network
 * errors and unparseable JSON) unwrap to their underlying transport / parser
 * error, so `received` and `cause` carry the raw diagnostic exactly as they
 * did before the resolver was introduced. Every other failure (timeout, size
 * cap, redirect cap, SSRF / URL-validation rejections) surfaces as
 * {@link SchemaLoaderNetworkError} with the typed resolver error preserved on
 * `cause`, because for those the typed error is the informative diagnostic.
 */
function toSchemaLoaderError(url: string, cause: unknown): Error {
  if (cause instanceof ResolverHttpError) {
    return new SchemaLoaderHttpError(url, cause.status);
  }
  if (cause instanceof ResolverInvalidJsonError) {
    return new SchemaLoaderInvalidJsonError(url, cause.cause ?? cause);
  }
  if (cause instanceof ResolverNetworkError) {
    return new SchemaLoaderNetworkError(url, cause.cause ?? cause);
  }
  return new SchemaLoaderNetworkError(url, cause);
}

/**
 * Fetches a schema through the guarded resolver so the URL passes the
 * `validatePublicUrl` SSRF guard (public scheme, non-private/non-metadata
 * address, IP-pinned) with the resolver's size, redirect, and timeout bounds
 * applied.
 *
 * @throws {SchemaLoaderNetworkError} if the request rejects, times out, or fails the SSRF guard.
 * @throws {SchemaLoaderHttpError} on a non-2xx HTTP status.
 * @throws {SchemaLoaderInvalidJsonError} if the body is not parseable as JSON.
 */
async function fetchSchema<T extends object>(url: string): Promise<T> {
  // Lazy import: the resolver stack pulls in undici, which jsdom test
  // environments cannot evaluate, so it loads at fetch time to keep this
  // module importable there.
  const { resolveJsonDocument } = await import('../resolvers/index.js');
  try {
    const { json } = await resolveJsonDocument(url, { accept: SCHEMA_ACCEPT, totalTimeoutMs: FETCH_TIMEOUT_MS });
    return json as T;
  } catch (cause) {
    throw toSchemaLoaderError(url, cause);
  }
}

/**
 * Returns a {@link SchemaLoader} that fetches schemas over HTTP through the
 * guarded resolver. If `cache` is supplied, results are read through the
 * cache; otherwise every call makes a fresh network request. Failed loads
 * are never cached; a successfully fetched and parsed document is cached
 * even if it later fails Ajv compilation.
 *
 * @throws {SchemaLoaderError} on `load(url)` if the underlying fetch fails.
 *   The concrete subclass identifies which step failed.
 */
export function createSchemaLoader<T extends object = object>(cache?: TtlCache<T>): SchemaLoader<T> {
  if (!cache) {
    return { load: (url) => fetchSchema<T>(url) };
  }
  return { load: (url) => cache.get(url, () => fetchSchema<T>(url)) };
}
