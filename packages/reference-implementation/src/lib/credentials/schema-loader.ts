import { makeInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { makeSchemaLoader, type SchemaLoader } from '@uncefact/untp-utils/schema-loaders';
import { apiLogger } from '@/lib/api/logger';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const logger = apiLogger.child({ module: 'schema-loader' });

export function readSchemaCacheTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SCHEMA_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn(
      { received: raw, fallbackTtlMs: DEFAULT_TTL_MS },
      'SCHEMA_CACHE_TTL_MS is not a non-negative finite number; falling back to the default TTL.',
    );
    return DEFAULT_TTL_MS;
  }
  return parsed;
}

export const schemaLoader: SchemaLoader = makeSchemaLoader(
  makeInMemoryTtlCache<object>({ ttlMs: readSchemaCacheTtlMs() }),
);
