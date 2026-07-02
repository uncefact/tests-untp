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
