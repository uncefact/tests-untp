import { createInMemoryTtlCache, type TtlCache } from '@uncefact/untp-utils/cache';
import type { LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';
import { apiLogger } from '../api/logger';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const logger = apiLogger.child({ module: 'context-cache' });

export function readContextCacheTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CONTEXT_CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn(
      { received: raw, fallbackTtlMs: DEFAULT_TTL_MS },
      'CONTEXT_CACHE_TTL_MS is not a non-negative finite number; falling back to the default TTL.',
    );
    return DEFAULT_TTL_MS;
  }
  return parsed;
}

/**
 * Shared cache for remote JSON-LD `@context` documents, passed to
 * `validateJsonLd` on the issuance and verification paths so a burst of
 * validations fetches each context once per TTL instead of once per
 * credential. Mirrors the schema loader's cache (`schema-loader.ts`);
 * see uncefact/tests-untp#886.
 */
export const contextCache: TtlCache<LoadedRemoteDocument> = createInMemoryTtlCache<LoadedRemoteDocument>({
  ttlMs: readContextCacheTtlMs(),
});
