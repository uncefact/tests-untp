import { jest } from '@jest/globals';
import { createInMemoryTtlCache } from './in-memory-ttl-cache.js';

describe('createInMemoryTtlCache', () => {
  describe('hit / miss', () => {
    it('returns the fetcher result on a miss', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      await expect(cache.get('a', async () => 'fetched')).resolves.toBe('fetched');
    });

    it('returns the cached value on a subsequent hit within the TTL', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      const fetcher = jest.fn(async () => 'fetched');
      await cache.get('a', fetcher);
      await cache.get('a', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refetches after the TTL expires', async () => {
      const realNow = Date.now;
      let now = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        const cache = createInMemoryTtlCache<string>({ ttlMs: 100 });
        const fetcher = jest.fn(async () => 'v');
        await cache.get('a', fetcher);
        now += 101;
        await cache.get('a', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = realNow;
      }
    });

    it('treats the TTL boundary strictly: ttlMs - 1 ms is a hit, ttlMs ms is a miss', async () => {
      const realNow = Date.now;
      let now = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        const cache = createInMemoryTtlCache<string>({ ttlMs: 100 });
        const fetcher = jest.fn(async (): Promise<string> => 'v');
        await cache.get('a', fetcher);
        now += 99;
        await cache.get('a', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        now += 1;
        await cache.get('a', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = realNow;
      }
    });

    it('treats ttlMs: 0 as a no-cache policy (always misses)', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 0 });
      const fetcher = jest.fn(async (): Promise<string> => 'v');
      await cache.get('a', fetcher);
      await cache.get('a', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate during inflight', () => {
    it('does not repopulate the cache when invalidate runs while a fetch is inflight', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 60_000 });
      let resolveFetcher!: (v: string) => void;
      const fetcher = jest.fn(
        () =>
          new Promise<string>((r) => {
            resolveFetcher = r;
          }),
      );

      const inflightLoad = cache.get('k', fetcher);
      await cache.invalidate('k');
      resolveFetcher('value-that-should-not-be-cached');
      await inflightLoad;

      const second = await cache.get(
        'k',
        jest.fn(async () => 'fresh-value'),
      );
      expect(second).toBe('fresh-value');
    });
  });

  describe('options', () => {
    it('rejects negative ttlMs', () => {
      expect(() => createInMemoryTtlCache({ ttlMs: -1 })).toThrow(RangeError);
    });

    it('rejects non-finite ttlMs', () => {
      expect(() => createInMemoryTtlCache({ ttlMs: NaN })).toThrow(RangeError);
      expect(() => createInMemoryTtlCache({ ttlMs: Infinity })).toThrow(RangeError);
    });
  });

  describe('retention bound (maxEntries)', () => {
    it('rejects a non-positive or non-integer maxEntries', () => {
      expect(() => createInMemoryTtlCache<string>({ ttlMs: 1000, maxEntries: 0 })).toThrow(RangeError);
      expect(() => createInMemoryTtlCache<string>({ ttlMs: 1000, maxEntries: 1.5 })).toThrow(RangeError);
      expect(() => createInMemoryTtlCache<string>({ ttlMs: 1000, maxEntries: -1 })).toThrow(RangeError);
    });

    it('evicts the least recently used entry when the cap is reached', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 60_000, maxEntries: 2 });
      const fetches: string[] = [];
      const fetcher = (v: string) => async () => {
        fetches.push(v);
        return v;
      };

      await cache.get('a', fetcher('a'));
      await cache.get('b', fetcher('b'));
      await cache.get('a', fetcher('a-refetch')); // touch a, so b is now least recent
      await cache.get('c', fetcher('c')); // cap reached: evicts b

      expect(await cache.get('a', fetcher('a-refetch'))).toBe('a'); // still cached
      expect(await cache.get('b', fetcher('b-refetch'))).toBe('b-refetch'); // evicted, refetched
      expect(fetches).toEqual(['a', 'b', 'c', 'b-refetch']);
    });

    it('evicts expired entries before evicting live ones', async () => {
      const realNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;
      try {
        const cache = createInMemoryTtlCache<string>({ ttlMs: 1000, maxEntries: 2 });
        await cache.get('old', async () => 'old');
        now += 2000; // 'old' expires
        await cache.get('live', async () => 'live');
        await cache.get('new', async () => 'new'); // cap: removes expired 'old', keeps 'live'
        const fetches: string[] = [];
        expect(
          await cache.get('live', async () => {
            fetches.push('live-refetch');
            return 'live-refetch';
          }),
        ).toBe('live');
        expect(fetches).toEqual([]);
      } finally {
        Date.now = realNow;
      }
    });

    it('removes an expired entry when it is met, even with no cap configured', async () => {
      const realNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;
      try {
        const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
        await cache.get('k', async () => 'v1');
        now += 2000;
        // Expired: refetches, and the stale entry is deleted rather than
        // lingering until this key happens to be rewritten.
        await expect(cache.get('k', async () => 'v2')).resolves.toBe('v2');
        expect(await cache.get('k', async () => 'v3')).toBe('v2');
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe('deduplication', () => {
    it('deduplicates concurrent fetches for the same key', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      let resolveFetcher!: (v: string) => void;
      const fetcher = jest.fn(
        () =>
          new Promise<string>((r) => {
            resolveFetcher = r;
          }),
      );
      const a = cache.get('k', fetcher);
      const b = cache.get('k', fetcher);
      resolveFetcher('done');
      await expect(a).resolves.toBe('done');
      await expect(b).resolves.toBe('done');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('runs fetcher independently for distinct keys', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      const fetcher = jest.fn(async (): Promise<string> => 'v');
      await cache.get('a', fetcher);
      await cache.get('b', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('errors', () => {
    it('propagates fetcher rejections without caching the failure', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      let attempt = 0;
      const fetcher = jest.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('boom');
        return 'ok';
      });
      await expect(cache.get('a', fetcher)).rejects.toThrow('boom');
      await expect(cache.get('a', fetcher)).resolves.toBe('ok');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('fans the same rejection out to every concurrent caller and retries on the next call', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      let rejectFetcher!: (err: Error) => void;
      const fetcher = jest.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectFetcher = reject;
          }),
      );

      const a = cache.get('k', fetcher);
      const b = cache.get('k', fetcher);
      const sharedError = new Error('shared boom');
      rejectFetcher(sharedError);

      const aErr = await a.catch((e: unknown) => e);
      const bErr = await b.catch((e: unknown) => e);
      expect(aErr).toBe(sharedError);
      expect(bErr).toBe(sharedError);
      expect(fetcher).toHaveBeenCalledTimes(1);

      const c = await cache.get(
        'k',
        jest.fn(async () => 'ok'),
      );
      expect(c).toBe('ok');
    });

    it('clears inflight on rejection so subsequent callers retry', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      let resolveFetcher: ((v: string) => void) | undefined;
      let rejectFetcher: ((err: Error) => void) | undefined;
      const fetcher = jest.fn(
        () =>
          new Promise<string>((r, rej) => {
            resolveFetcher = r;
            rejectFetcher = rej;
          }),
      );
      const first = cache.get('k', fetcher);
      rejectFetcher!(new Error('first fail'));
      await expect(first).rejects.toThrow('first fail');

      const second = cache.get('k', fetcher);
      resolveFetcher!('second ok');
      await expect(second).resolves.toBe('second ok');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate / clear', () => {
    it('invalidate removes a single key without touching others', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      const fetcher = jest.fn(async (): Promise<string> => 'v');
      await cache.get('a', fetcher);
      await cache.get('b', fetcher);
      await cache.invalidate('a');
      await cache.get('a', fetcher);
      await cache.get('b', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('clear removes every cached value', async () => {
      const cache = createInMemoryTtlCache<string>({ ttlMs: 1000 });
      const fetcher = jest.fn(async (): Promise<string> => 'v');
      await cache.get('a', fetcher);
      await cache.get('b', fetcher);
      await cache.clear();
      await cache.get('a', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(3);
    });
  });
});
