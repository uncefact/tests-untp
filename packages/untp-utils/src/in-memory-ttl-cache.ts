import type { TtlCache, TtlCacheOptions } from './ttl-cache.js';

export function makeInMemoryTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const { ttlMs } = options;
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new RangeError(`ttlMs must be a non-negative finite number, got ${ttlMs}.`);
  }
  const cache = new Map<string, { value: T; storedAt: number }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    async get(key, fetcher) {
      if (ttlMs > 0) {
        const cached = cache.get(key);
        if (cached && Date.now() - cached.storedAt < ttlMs) {
          return cached.value;
        }
      }

      const existing = inflight.get(key);
      if (existing) return existing;

      let promise!: Promise<T>;
      promise = (async () => {
        try {
          const value = await fetcher();
          if (ttlMs > 0 && inflight.get(key) === promise) {
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
