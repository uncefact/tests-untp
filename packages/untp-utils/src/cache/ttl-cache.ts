export interface TtlCacheOptions {
  /** TTL in ms. `0` disables caching. */
  ttlMs: number;
  /**
   * Maximum number of stored entries. When a write would exceed it, expired
   * entries are removed first, then the least recently used live entry is
   * evicted. Omit for no bound (suitable only when keys come from trusted
   * configuration; caller-controlled keys need a cap so a stream of unique
   * keys cannot grow process memory without limit).
   */
  maxEntries?: number;
}

export interface TtlCache<T> {
  /**
   * Returns the cached value for `key` if fresh; otherwise invokes
   * `fetcher`, stores its result, and returns it. Implementations may
   * deduplicate concurrent misses; rejected fetches are not cached.
   */
  get(key: string, fetcher: () => Promise<T>): Promise<T>;
  invalidate(key: string): Promise<void>;
  clear(): Promise<void>;
}
