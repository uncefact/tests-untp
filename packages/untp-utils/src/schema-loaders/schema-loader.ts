import type { TtlCache } from '../cache/ttl-cache.js';
import { SchemaLoaderHttpError, SchemaLoaderInvalidJsonError, SchemaLoaderNetworkError } from './errors.js';

export interface SchemaLoader {
  load(url: string): Promise<object>;
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * @throws {SchemaLoaderNetworkError} if the network request rejects or times out.
 * @throws {SchemaLoaderHttpError} on a non-2xx HTTP status.
 * @throws {SchemaLoaderInvalidJsonError} if the body is not parseable as JSON.
 */
async function fetchSchema(url: string): Promise<object> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (cause) {
    throw new SchemaLoaderNetworkError(url, cause);
  }

  if (!response.ok) {
    throw new SchemaLoaderHttpError(url, response.status);
  }

  try {
    return (await response.json()) as object;
  } catch (cause) {
    throw new SchemaLoaderInvalidJsonError(url, cause);
  }
}

/**
 * Returns a {@link SchemaLoader} that fetches schemas over HTTP. If `cache`
 * is supplied, results are read through the cache; otherwise every call
 * makes a fresh network request.
 *
 * @throws {SchemaLoaderError} on `load(url)` if the underlying fetch fails.
 *   The concrete subclass identifies which step failed.
 */
export function makeSchemaLoader(cache?: TtlCache<object>): SchemaLoader {
  if (!cache) {
    return { load: (url) => fetchSchema(url) };
  }
  return { load: (url) => cache.get(url, () => fetchSchema(url)) };
}
