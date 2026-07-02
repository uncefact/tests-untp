import type { TtlCache } from '../cache/ttl-cache.js';
import { resolveJsonDocument, ResolverHttpError, ResolverInvalidJsonError } from '../resolvers/index.js';
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
 * contract. HTTP-status and invalid-JSON failures keep their dedicated types;
 * every other failure (network error, timeout, size cap, redirect cap, and
 * SSRF / URL-validation rejections) surfaces as {@link SchemaLoaderNetworkError}
 * with the original resolver error preserved on `cause`.
 */
function toSchemaLoaderError(url: string, cause: unknown): Error {
  if (cause instanceof ResolverHttpError) {
    return new SchemaLoaderHttpError(url, cause.status);
  }
  if (cause instanceof ResolverInvalidJsonError) {
    return new SchemaLoaderInvalidJsonError(url, cause);
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
 * cache; otherwise every call makes a fresh network request.
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
