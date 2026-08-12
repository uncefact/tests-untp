import type { TtlCache, TtlCacheOptions } from './ttl-cache.js';

export function createInMemoryTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const { ttlMs, maxEntries } = options;
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new RangeError(`ttlMs must be a non-negative finite number, got ${ttlMs}.`);
  }
  if (maxEntries !== undefined && (!Number.isInteger(maxEntries) || maxEntries < 1)) {
    throw new RangeError(`maxEntries must be a positive integer when supplied, got ${maxEntries}.`);
  }
  const cache = new Map<string, { value: T; storedAt: number }>();
  const inflight = new Map<string, Promise<T>>();

  const isFresh = (storedAt: number): boolean => Date.now() - storedAt < ttlMs;

  // Retention bound: expired entries go first (they are dead weight whatever
  // the cap), then the least recently used live entry. Recency comes from
  // Map insertion order: hits re-insert their key (see get), so iteration
  // order is oldest-touched first.
  const evictForCapacity = (): void => {
    if (maxEntries === undefined || cache.size < maxEntries) return;
    for (const [key, entry] of cache) {
      if (!isFresh(entry.storedAt)) cache.delete(key);
    }
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value as string;
      cache.delete(oldest);
    }
  };

  return {
    async get(key, fetcher) {
      if (ttlMs > 0) {
        const cached = cache.get(key);
        if (cached) {
          if (isFresh(cached.storedAt)) {
            // Re-insert so Map iteration order tracks recency for eviction.
            cache.delete(key);
            cache.set(key, cached);
            return cached.value;
          }
          // Expired entries are removed when met rather than lingering until
          // the same key happens to be rewritten.
          cache.delete(key);
        }
      }

      const existing = inflight.get(key);
      if (existing) return existing;

      let promise!: Promise<T>;
      promise = (async () => {
        try {
          const value = await fetcher();
          if (ttlMs > 0 && inflight.get(key) === promise) {
            evictForCapacity();
            cache.set(key, { value, storedAt: Date.now() });
          }
          return value;
        } finally {
          if (inflight.get(key) === promise) {
            inflight.delete(key);
          }
        }
      })();

      inflight.set(key, promise);
      return promise;
    },
    async invalidate(key) {
      cache.delete(key);
      inflight.delete(key);
    },
    async clear() {
      cache.clear();
      inflight.clear();
    },
  };
}
