import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { createSchemaLoader, type SchemaLoader } from '@uncefact/untp-utils/loaders';
import { apiLogger } from '../api/logger';
import { readBundledArtefactsFallback } from '../config/bundled-artefacts-fallback.config';
import { readCacheMaxEntries } from '../config/cache-max-entries.config';

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

/**
 * Logs each time a bundled UNTP schema stood in for one the publishing host
 * could not deliver (see uncefact/tests-untp#1006). The fetch's own error is
 * the reason, so the operator can tell an outage from a wrong URL.
 */
export function logBundledFallback(event: { url: string; cause: unknown }): void {
  logger.warn(
    { url: event.url, err: event.cause },
    'Served the bundled copy of a UNTP artefact because its fetch failed',
  );
}

/** Shared by the schema loader and the JSON-LD validation so both honour BUNDLED_ARTEFACTS_FALLBACK. */
export const bundledArtefactsFallback = {
  bundledFallback: readBundledArtefactsFallback(),
  onBundledFallback: logBundledFallback,
};

export const schemaLoader: SchemaLoader = createSchemaLoader(
  createInMemoryTtlCache<object>({ ttlMs: readSchemaCacheTtlMs(), maxEntries: readCacheMaxEntries() }),
  bundledArtefactsFallback,
);
