/**
 * Schema Cache Service
 *
 * Fetches JSON Schema from a URL and caches it in memory with a configurable
 * TTL. Used downstream to validate credential payloads against their schema.
 */

// ── Custom Error ────────────────────────────────────────────────────────────

export class SchemaFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaFetchError';
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface CachedSchema {
  schema: object;
  fetchedAt: number;
}

// ── Cache ───────────────────────────────────────────────────────────────────

const schemaCache = new Map<string, CachedSchema>();

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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch a JSON Schema from the given URL, returning a cached copy when
 * available and not yet expired.
 *
 * @throws {SchemaFetchError} If the network request fails, the server returns
 *   a non-200 status, or the response body is not valid JSON.
 */
export async function fetchSchema(schemaUrl: string): Promise<object> {
  const ttl = getTtlMs();
  const cached = schemaCache.get(schemaUrl);

  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.schema;
  }

  let response: Response;
  try {
    response = await fetch(schemaUrl);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SchemaFetchError(`Failed to fetch schema from ${schemaUrl}: ${detail}`);
  }

  if (!response.ok) {
    throw new SchemaFetchError(`Failed to fetch schema from ${schemaUrl}: received status ${response.status}`);
  }

  let schema: object;
  try {
    schema = (await response.json()) as object;
  } catch {
    throw new SchemaFetchError(`Invalid JSON returned from ${schemaUrl}`);
  }

  schemaCache.set(schemaUrl, { schema, fetchedAt: Date.now() });

  return schema;
}

/** Clear all cached schema entries. */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

/** Expose the cache map (for testing / diagnostics only). */
export function getSchemaCache(): Map<string, CachedSchema> {
  return schemaCache;
}
