const DEFAULT_MAX_ENTRIES = 1000;

/**
 * CACHE_MAX_ENTRIES caps how many entries each in-memory document cache
 * (remote JSON-LD contexts, JSON Schemas) retains; expired entries are
 * evicted first, then the least recently used. The bound exists because
 * context cache keys come from caller-controlled `@context` URLs; without
 * it, a stream of unique URLs grows process memory until restart. Unset or
 * blank uses the default; a provided value that is not a positive integer
 * throws, surfaced at process boot (instrumentation.node.ts), so a
 * misconfigured cap fails the container start instead of silently running
 * with a different bound.
 */
export function readCacheMaxEntries(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CACHE_MAX_ENTRIES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_ENTRIES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `CACHE_MAX_ENTRIES must be a positive integer when set; fix or unset it (unset uses ${DEFAULT_MAX_ENTRIES}).`,
    );
  }
  return parsed;
}

/**
 * Boot-time check (instrumentation.node.ts): parses CACHE_MAX_ENTRIES for
 * its side effect only, so a provided-and-invalid value fails startup with
 * the reader's message instead of surfacing when a cache is first built.
 */
export function validateCacheMaxEntriesOnBoot(env: Record<string, string | undefined> = process.env): void {
  readCacheMaxEntries(env);
}
