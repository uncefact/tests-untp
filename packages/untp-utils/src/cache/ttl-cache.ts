export interface TtlCacheOptions {
  /** TTL in ms. `0` disables caching. */
  ttlMs: number;
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
