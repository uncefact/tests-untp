import type { ValidationError, ValidationOutcome } from '../validation-outcome.js';
import { SchemaLoaderCode } from '../validation/codes.js';

/**
 * Fetches JSON Schema from a URL and caches the response in memory with a
 * configurable TTL. Used downstream by {@link validateAgainstSchemas} and by
 * any consumer that needs raw schema content.
 *
 * Concurrent requests for the same uncached URL are deduplicated: only one
 * network request is made and all callers receive the same outcome.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedSchema {
  schema: object;
  fetchedAt: number;
}

/**
 * Result of {@link fetchSchema}. `value` is present iff `errors.length === 0`.
 */
export interface FetchSchemaOutcome extends ValidationOutcome {
  value?: object;
}

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

const schemaCache = new Map<string, CachedSchema>();
const inflightRequests = new Map<string, Promise<FetchSchemaOutcome>>();

/** Default TTL: 1 hour (3 600 000 ms). Override with SCHEMA_CACHE_TTL_MS. */
const DEFAULT_TTL_MS = 3_600_000;

function getTtlMs(): number {
  const envValue = process.env.SCHEMA_CACHE_TTL_MS;
  if (envValue !== undefined) {
    const parsed = Number(envValue);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TTL_MS;
}

// ---------------------------------------------------------------------------
// Internal fetch
// ---------------------------------------------------------------------------

async function doFetch(schemaUrl: string): Promise<FetchSchemaOutcome> {
  const errors: ValidationError[] = [];

  let response: Response;
  try {
    response = await fetch(schemaUrl);
  } catch (error: unknown) {
    errors.push({
      code: SchemaLoaderCode.NetworkError,
      message: 'Could not reach the schema URL.',
      received: error instanceof Error ? error.message : String(error),
      expected: `a 2xx response from ${schemaUrl}`,
      raw: error,
    });
    return { errors, warnings: [] };
  }

  if (!response.ok) {
    errors.push({
      code: SchemaLoaderCode.HttpError,
      message: `Schema URL returned status ${response.status}.`,
      received: response.status,
      expected: '2xx',
    });
    return { errors, warnings: [] };
  }

  let schema: object;
  try {
    schema = (await response.json()) as object;
  } catch (error) {
    errors.push({
      code: SchemaLoaderCode.InvalidJson,
      message: 'Schema URL returned a body that is not valid JSON.',
      received: error instanceof Error ? error.message : String(error),
      raw: error,
    });
    return { errors, warnings: [] };
  }

  schemaCache.set(schemaUrl, { schema, fetchedAt: Date.now() });

  return { value: schema, errors: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches a JSON Schema from the given URL, returning a cached copy when
 * available and not yet expired. Concurrent requests for the same URL are
 * deduplicated so only one network call is made.
 *
 * Per ADR-034, this function does not throw for input-related failures.
 * Network failures, HTTP errors, and invalid JSON all surface as entries
 * in `errors[]`; the schema is in `value` on success.
 */
export async function fetchSchema(schemaUrl: string): Promise<FetchSchemaOutcome> {
  const ttl = getTtlMs();
  const cached = schemaCache.get(schemaUrl);

  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return { value: cached.schema, errors: [], warnings: [] };
  }

  const inflight = inflightRequests.get(schemaUrl);
  if (inflight) {
    return inflight;
  }

  const promise = doFetch(schemaUrl).finally(() => {
    inflightRequests.delete(schemaUrl);
  });

  inflightRequests.set(schemaUrl, promise);

  return promise;
}

/** Clears all cached schema entries and in-flight requests. */
export function clearSchemaCache(): void {
  schemaCache.clear();
  inflightRequests.clear();
}

/** Exposes the cache map (for testing and diagnostics only). */
export function getSchemaCache(): Map<string, CachedSchema> {
  return schemaCache;
}
