// The factory runs when pg-boss is first required (hoisted above the
// imports below), so the mock state lives inside it and is reached back
// through jest.requireMock.
jest.mock('pg-boss', () => {
  const bossMock = {
    on: jest.fn(),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    send: jest.fn(async () => 'job-id'),
    schedule: jest.fn(async () => undefined),
    unschedule: jest.fn(async () => undefined),
    work: jest.fn(async () => 'worker-id'),
    createQueue: jest.fn(async () => undefined),
    getQueue: jest.fn(async () => null),
    updateQueue: jest.fn(async () => undefined),
    complete: jest.fn(async () => undefined),
    fail: jest.fn(async () => undefined),
    getDb: jest.fn(() => ({ executeSql: jest.fn(async () => ({ rows: [] })) })),
    getWipData: jest.fn(() => [] as { lastFetchedOn: number | null; lastJobStartedOn: number | null; count: number }[]),
  };
  const mockState = { constructorArgs: [] as unknown[] };
  class PgBoss {
    constructor(...args: unknown[]) {
      mockState.constructorArgs = args;
      // eslint-disable-next-line no-constructor-return
      return bossMock as unknown as PgBoss;
    }
  }
  return { PgBoss, __bossMock: bossMock, __mockState: mockState };
});

import { JobQueueError } from './errors';
import { PgBossJobQueue } from './pg-boss-job-queue';

const { __bossMock: bossMock, __mockState: mockState } = jest.requireMock('pg-boss') as {
  __bossMock: Record<string, jest.Mock>;
  __mockState: { constructorArgs: unknown[] };
};

/**
 * The store the mock plays back: pg-boss's createQueue is create-if-absent
 * (a second create never changes the stored policy), and getQueue returns
 * what is actually stored, which is the behaviour the adapter's read-back
 * exists to observe.
 */
const storedQueues = new Map<string, string>();

const makeQueue = (options: object = {}) =>
  new PgBossJobQueue({ connectionString: 'postgres://example/db', ...options });

/** The per-queue callback the adapter hands to boss.work, captured for direct invocation. */
const capturedWorkCallback = (): ((jobs: object[]) => Promise<unknown>) => {
  const call = bossMock.work.mock.calls.at(-1);
  if (call === undefined) throw new Error('boss.work was never called');
  return call[2] as (jobs: object[]) => Promise<unknown>;
};

const job = (overrides: object = {}) => ({
  id: 'job-1',
  data: { recordId: 'r1' },
  retryCount: 0,
  retryLimit: 2,
  signal: new AbortController().signal,
  ...overrides,
});

beforeEach(() => {
  for (const fn of Object.values(bossMock)) fn.mockClear();
  storedQueues.clear();
  bossMock.createQueue.mockImplementation(async (...args: unknown[]) => {
    const [name, options] = args as [string, { policy: string }];
    if (!storedQueues.has(name)) storedQueues.set(name, options.policy);
  });
  bossMock.getQueue.mockImplementation(async (...args: unknown[]) => {
    const [name] = args as [string];
    const policy = storedQueues.get(name);
    return policy === undefined ? null : { policy };
  });
  mockState.constructorArgs = [];
});

describe('constructor', () => {
  it('passes schema to pg-boss only when one is given', () => {
    makeQueue({ schema: 'jobs' });
    expect(mockState.constructorArgs[0]).toEqual({
      connectionString: 'postgres://example/db',
      useListenNotify: true,
      queueCacheIntervalSeconds: 5,
      schema: 'jobs',
    });
    makeQueue();
    expect(mockState.constructorArgs[0]).toEqual({
      connectionString: 'postgres://example/db',
      useListenNotify: true,
      queueCacheIntervalSeconds: 5,
    });
    expect(Object.keys(mockState.constructorArgs[0] as object)).not.toContain('schema');
  });

  it('wires a caller-supplied onError as the error listener', () => {
    const onError = jest.fn();
    makeQueue({ onError });
    const call = bossMock.on.mock.calls.find(([event]) => event === 'error') as [string, (error: Error) => void];
    const listener = call[1];
    const failure = new Error('connection lost');
    listener(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('routes pg-boss warnings to the error channel', () => {
    const onError = jest.fn();
    makeQueue({ onError });
    const call = bossMock.on.mock.calls.find(([event]) => event === 'warning') as [string, (w: object) => void];
    call[1]({ message: 'LISTEN/NOTIFY unavailable, polling only' });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('LISTEN/NOTIFY unavailable') }),
    );
  });

  it('preserves the message of object-shaped pg-boss error payloads', () => {
    const onError = jest.fn();
    makeQueue({ onError });
    const call = bossMock.on.mock.calls.find(([event]) => event === 'error') as [string, (payload: object) => void];
    call[1]({ message: 'queue cache refresh failed', queue: 'issue', worker: 'w1' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'queue cache refresh failed' }));
  });

  it('contains a throwing onError instead of letting it propagate', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      makeQueue({
        onError: () => {
          throw new Error('reporter bug');
        },
      });
      const call = bossMock.on.mock.calls.find(([event]) => event === 'error') as [string, (error: Error) => void];
      expect(() => call[1](new Error('infrastructure failure'))).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('contains a rejecting async onError', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      makeQueue({ onError: async () => Promise.reject(new Error('async reporter bug')) });
      const call = bossMock.on.mock.calls.find(([event]) => event === 'error') as [string, (error: Error) => void];
      expect(() => call[1](new Error('infrastructure failure'))).not.toThrow();
      await Promise.resolve().then(() => Promise.resolve());
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('rejects a defaultRetry whose backoff cap has no starting delay', () => {
    expect(() => makeQueue({ defaultRetry: { limit: 2, backoffMaxSeconds: 60 } })).toThrow(
      'defaultRetry.backoffMaxSeconds requires defaultRetry.backoffSeconds',
    );
  });

  it('falls back to console.error when no onError is supplied', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      makeQueue();
      const call = bossMock.on.mock.calls.find(([event]) => event === 'error') as [string, (error: Error) => void];
      const listener = call[1];
      listener(new Error('maintenance failed'));
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('enqueue option mapping', () => {
  it('maps every EnqueueOption to its pg-boss send option', async () => {
    const queue = makeQueue();
    const startAfter = new Date('2026-01-01T00:00:00Z');
    await queue.enqueue(
      'issue',
      { recordId: 'r1' },
      {
        dedupeKey: 'issue:r1',
        fairnessKey: 'tenant-a',
        startAfter,
        expireSeconds: 120,
        retry: { limit: 3, backoffSeconds: 30, backoffMaxSeconds: 600 },
      },
    );
    expect(bossMock.send).toHaveBeenCalledWith(
      'issue',
      { recordId: 'r1' },
      {
        singletonKey: 'issue:r1',
        group: { id: 'tenant-a' },
        startAfter,
        expireInSeconds: 120,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 600,
      },
    );
  });

  it('sends no options when none are given', async () => {
    const queue = makeQueue();
    await queue.enqueue('issue', { recordId: 'r1' });
    expect(bossMock.send).toHaveBeenCalledWith('issue', { recordId: 'r1' }, {});
  });

  it('applies retry without backoff as a bare retryLimit', async () => {
    const queue = makeQueue();
    await queue.enqueue('issue', {}, { retry: { limit: 1 } });
    expect(bossMock.send).toHaveBeenCalledWith('issue', {}, { retryLimit: 1 });
  });

  it('falls back to the constructor defaultRetry when the send names none', async () => {
    const queue = makeQueue({ defaultRetry: { limit: 5, backoffSeconds: 10 } });
    await queue.enqueue('issue', {});
    expect(bossMock.send).toHaveBeenCalledWith('issue', {}, { retryLimit: 5, retryDelay: 10, retryBackoff: true });
  });

  it('lets a per-send retry override the defaultRetry', async () => {
    const queue = makeQueue({ defaultRetry: { limit: 5 } });
    await queue.enqueue('issue', {}, { retry: { limit: 0 } });
    expect(bossMock.send).toHaveBeenCalledWith('issue', {}, { retryLimit: 0 });
  });
});

describe('enqueue validation', () => {
  it('rejects a retry whose backoff cap has no starting delay', async () => {
    const queue = makeQueue();
    await expect(queue.enqueue('issue', {}, { retry: { limit: 2, backoffMaxSeconds: 60 } })).rejects.toThrow(
      'retry.backoffMaxSeconds requires retry.backoffSeconds',
    );
    expect(bossMock.send).not.toHaveBeenCalled();
  });

  it('rejects fractional backoff values and invalid expire or fairness options', async () => {
    const queue = makeQueue();
    await expect(queue.enqueue('issue', {}, { retry: { limit: 1, backoffSeconds: 0.5 } })).rejects.toThrow(
      'retry.backoffSeconds must be a positive integer',
    );
    await expect(queue.enqueue('issue', {}, { expireSeconds: 0 })).rejects.toThrow(
      'expireSeconds must be a positive integer of at most 24 hours',
    );
    await expect(queue.enqueue('issue', {}, { expireSeconds: 25 * 60 * 60 })).rejects.toThrow(
      'expireSeconds must be a positive integer of at most 24 hours',
    );
    await expect(queue.enqueue('issue', {}, { fairnessKey: '' })).rejects.toThrow(
      'fairnessKey must be a non-empty string',
    );
    expect(bossMock.send).not.toHaveBeenCalled();
  });

  it('rejects a negative or fractional retry limit', async () => {
    const queue = makeQueue();
    await expect(queue.enqueue('issue', {}, { retry: { limit: -1 } })).rejects.toThrow(
      'retry.limit must be a non-negative integer',
    );
    await expect(queue.enqueue('issue', {}, { retry: { limit: 1.5 } })).rejects.toThrow(
      'retry.limit must be a non-negative integer',
    );
  });
});

describe('transactional enqueue', () => {
  it('passes the caller transaction to pg-boss as the db option', async () => {
    const queue = makeQueue();
    const tx = { executeSql: jest.fn(async () => ({ rows: [] })) };
    await queue.enqueueWithin(tx, 'issue', { recordId: 'r1' });
    expect(bossMock.send).toHaveBeenCalledWith('issue', { recordId: 'r1' }, { db: tx });
  });
});

describe('declareQueue', () => {
  it('creates the queue up front with the policy the declaration names', async () => {
    const queue = makeQueue();
    await queue.declareQueue('verify');
    await queue.declareQueue('dedup', { dedupeWaiting: true });
    expect(bossMock.createQueue).toHaveBeenCalledWith('verify', { policy: 'standard', notify: true });
    expect(bossMock.createQueue).toHaveBeenCalledWith('dedup', { policy: 'short', notify: true });
  });

  it('is idempotent and leaves a later send as one insert', async () => {
    const queue = makeQueue();
    await queue.declareQueue('verify');
    await queue.declareQueue('verify');
    const tx = { executeSql: jest.fn(async () => ({ rows: [] })) };
    await queue.enqueueWithin(tx, 'verify', { recordId: 'r1' });
    expect(bossMock.createQueue).toHaveBeenCalledTimes(1);
    expect(bossMock.send).toHaveBeenCalledWith('verify', { recordId: 'r1' }, { db: tx });
  });

  it('rejects a send whose policy contradicts the declared queue', async () => {
    const queue = makeQueue();
    await queue.declareQueue('verify');
    await expect(queue.enqueue('verify', { recordId: 'r1' }, { dedupeKey: 'r1' })).rejects.toMatchObject({
      code: 'jobs.queue-policy-mismatch',
    });
  });
});

describe('a send that inserts no job', () => {
  // pg-boss reports an insert that did not happen by returning null, never by
  // throwing, so resolving on a null would hand the caller a job it does not
  // have.
  const tx = () => ({ executeSql: jest.fn(async () => ({ rows: [] })) });

  it('throws from enqueue when the caller named no dedupeKey', async () => {
    bossMock.send.mockResolvedValueOnce(null);
    const queue = makeQueue();

    await expect(queue.enqueue('issue', { recordId: 'r1' })).rejects.toMatchObject({
      code: 'jobs.enqueue-not-inserted',
      message: expect.stringContaining("queue 'issue' accepted no job"),
    });
  });

  it('throws from enqueueWithin when the caller named no dedupeKey', async () => {
    bossMock.send.mockResolvedValueOnce(null);
    const queue = makeQueue();

    await expect(queue.enqueueWithin(tx(), 'issue', { recordId: 'r1' })).rejects.toMatchObject({
      code: 'jobs.enqueue-not-inserted',
    });
  });

  it('accepts the null from enqueue as the documented suppression of a duplicate while the queue still exists', async () => {
    bossMock.send.mockResolvedValueOnce(null);
    const queue = makeQueue();

    await expect(queue.enqueue('dedup', { recordId: 'r1' }, { dedupeKey: 'issue:r1' })).resolves.toBeUndefined();
    expect(bossMock.getQueue).toHaveBeenLastCalledWith('dedup');
  });

  it('accepts the null from enqueueWithin as the documented suppression of a duplicate while the queue still exists', async () => {
    bossMock.send.mockResolvedValueOnce(null);
    const queue = makeQueue();

    await expect(
      queue.enqueueWithin(tx(), 'dedup', { recordId: 'r1' }, { dedupeKey: 'issue:r1' }),
    ).resolves.toBeUndefined();
    expect(bossMock.getQueue).toHaveBeenLastCalledWith('dedup');
  });

  it('throws from a keyed enqueue whose null came from a queue that no longer exists', async () => {
    // The same null covers a suppressed duplicate and a removed queue; the
    // read-back is what tells them apart.
    const queue = makeQueue();
    // The queue is known to this process from an earlier send; pg-boss then
    // reports the next send as no row, and the read-back finds no queue.
    await queue.enqueue('dedup', { recordId: 'r0' }, { dedupeKey: 'issue:r0' });
    bossMock.send.mockResolvedValueOnce(null);
    bossMock.getQueue.mockResolvedValueOnce(null);

    await expect(queue.enqueue('dedup', { recordId: 'r1' }, { dedupeKey: 'issue:r1' })).rejects.toMatchObject({
      code: 'jobs.enqueue-not-inserted',
    });
  });

  it('throws from a keyed enqueueWithin whose null came from a queue that no longer exists', async () => {
    const queue = makeQueue();
    await queue.enqueueWithin(tx(), 'dedup', { recordId: 'r0' }, { dedupeKey: 'issue:r0' });
    bossMock.send.mockResolvedValueOnce(null);
    bossMock.getQueue.mockResolvedValueOnce(null);

    await expect(
      queue.enqueueWithin(tx(), 'dedup', { recordId: 'r1' }, { dedupeKey: 'issue:r1' }),
    ).rejects.toMatchObject({ code: 'jobs.enqueue-not-inserted' });
  });
});

describe('queue policy', () => {
  it('creates a short-policy queue for a keyed send and standard for an unkeyed one', async () => {
    const queue = makeQueue();
    await queue.enqueue('dedup', {}, { dedupeKey: 'k' });
    expect(bossMock.createQueue).toHaveBeenCalledWith('dedup', { policy: 'short', notify: true });
    await queue.enqueue('plain', {});
    expect(bossMock.createQueue).toHaveBeenCalledWith('plain', { policy: 'standard', notify: true });
  });

  it('creates each queue once, not per send', async () => {
    const queue = makeQueue();
    await queue.enqueue('issue', {});
    await queue.enqueue('issue', {});
    expect(bossMock.createQueue).toHaveBeenCalledTimes(1);
  });

  it('caches the policy the store actually holds, not the one requested', async () => {
    storedQueues.set('issue', 'standard');
    const queue = makeQueue();
    await expect(queue.enqueue('issue', {}, { dedupeKey: 'k' })).rejects.toThrow(
      "queue 'issue' is 'standard' but this use needs 'short'",
    );
    expect(bossMock.send).not.toHaveBeenCalled();
  });

  it('rejects an unkeyed send to a queue another process created as deduplicating', async () => {
    storedQueues.set('issue', 'short');
    const queue = makeQueue();
    await expect(queue.enqueue('issue', {})).rejects.toThrow("queue 'issue' is 'short' but this use needs 'standard'");
  });

  it('rejects a send whose key use contradicts the queue it declared earlier', async () => {
    const queue = makeQueue();
    await queue.enqueue('issue', {}, { dedupeKey: 'k' });
    await expect(queue.enqueue('issue', {})).rejects.toThrow(JobQueueError);
  });

  it('rejects the loser of two concurrent first sends with contradicting key use', async () => {
    const queue = makeQueue();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    bossMock.createQueue.mockImplementationOnce(async (...args: unknown[]) => {
      const [name, options] = args as [string, { policy: string }];
      await gate;
      storedQueues.set(name, options.policy);
    });
    const keyed = queue.enqueue('issue', {}, { dedupeKey: 'k' });
    const unkeyed = queue.enqueue('issue', {});
    release();
    await expect(Promise.all([keyed, unkeyed])).rejects.toThrow(
      "queue 'issue' is 'short' but this use needs 'standard'",
    );
    expect(bossMock.createQueue).toHaveBeenCalledTimes(1);
  });

  it('propagates creation failures', async () => {
    const queue = makeQueue();
    bossMock.createQueue.mockImplementationOnce(async () => {
      throw new Error('connection refused');
    });
    await expect(queue.enqueue('issue', {})).rejects.toThrow('connection refused');
  });

  it('rejects a queue whose stored policy this adapter does not model', async () => {
    storedQueues.set('issue', 'exclusive');
    const queue = makeQueue();
    await expect(queue.enqueue('issue', {})).rejects.toThrow(
      "queue 'issue' exists with policy 'exclusive', which this job queue does not support",
    );
    expect(bossMock.send).not.toHaveBeenCalled();
  });

  it('fails when the queue cannot be read back after creation', async () => {
    const queue = makeQueue();
    bossMock.createQueue.mockImplementationOnce(async () => undefined);
    await expect(queue.enqueue('issue', {})).rejects.toThrow("queue 'issue' was not found after creating it");
  });
});

describe('registration and lifecycle', () => {
  it('rejects registration after start', async () => {
    const queue = makeQueue();
    await queue.start();
    expect(() => queue.register('late', async () => undefined)).toThrow(
      "register('late') called after start(); register all handlers first",
    );
  });

  it('rejects a per-key cap larger than the worker pool at registration', () => {
    const queue = makeQueue();
    expect(() => queue.register('issue', async () => undefined, { perKeyConcurrency: 2 })).toThrow(
      "register('issue'): perKeyConcurrency (2) cannot exceed concurrency (1)",
    );
    expect(() => queue.register('issue', async () => undefined, { concurrency: 0 })).toThrow(
      "register('issue'): concurrency must be a positive integer",
    );
  });

  it('start after a completed stop boots afresh', async () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined);
    await queue.start();
    await queue.stop();
    await queue.start();
    expect(bossMock.start).toHaveBeenCalledTimes(2);
    expect(bossMock.work).toHaveBeenCalledTimes(2);
  });

  it('rejects a duplicate registration of one job name', () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined);
    expect(() => queue.register('issue', async () => undefined)).toThrow(
      "register('issue') called twice; each job name has exactly one handler",
    );
  });

  it('starts and stops the underlying boss once across repeated calls', async () => {
    const queue = makeQueue();
    await queue.start();
    await queue.start();
    expect(bossMock.start).toHaveBeenCalledTimes(1);
    await queue.stop();
    await queue.stop();
    expect(bossMock.stop).toHaveBeenCalledTimes(1);
  });

  it("probe queries through pg-boss's own pool and reports each consumer separately", async () => {
    const queue = makeQueue();
    bossMock.getWipData.mockReturnValue([
      { lastFetchedOn: 1_000, lastJobStartedOn: 900, count: 0 },
      { lastFetchedOn: 3_000, lastJobStartedOn: null, count: 2 },
    ]);
    await expect(queue.probe()).resolves.toEqual({
      consumers: [
        { lastFetchedOn: 1_000, lastJobStartedOn: 900, activeJobs: 0 },
        { lastFetchedOn: 3_000, lastJobStartedOn: null, activeJobs: 2 },
      ],
    });
    expect(bossMock.getDb).toHaveBeenCalled();
  });

  it('probe rejects when the pool cannot answer', async () => {
    const queue = makeQueue();
    bossMock.getDb.mockReturnValueOnce({
      executeSql: jest.fn(async () => {
        throw new Error('pool exhausted');
      }),
    });
    await expect(queue.probe()).rejects.toThrow('pool exhausted');
  });

  it('passes a drain timeout through to pg-boss and otherwise leaves its default alone', async () => {
    // The worker bounds its drain; the web does not. Fails if the option is
    // dropped on the floor or a default is invented here.
    const queue = makeQueue();
    await queue.start();
    await queue.stop({ drainTimeoutMs: 30_000 });
    expect(bossMock.stop).toHaveBeenLastCalledWith({ graceful: true, timeout: 30_000 });

    const plain = makeQueue();
    await plain.start();
    await plain.stop();
    expect(bossMock.stop).toHaveBeenLastCalledWith({ graceful: true });
  });

  it('coalesces concurrent starts into one boot', async () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined);
    await Promise.all([queue.start(), queue.start()]);
    expect(bossMock.start).toHaveBeenCalledTimes(1);
    expect(bossMock.work).toHaveBeenCalledTimes(1);
  });

  it('stop during an in-flight start waits for the boot and then shuts down', async () => {
    const queue = makeQueue();
    let releaseStart: () => void = () => undefined;
    bossMock.start.mockImplementationOnce(async () => new Promise<void>((resolve) => (releaseStart = resolve)));
    const starting = queue.start();
    const stopping = queue.stop();
    releaseStart();
    await starting;
    await stopping;
    expect(bossMock.stop).toHaveBeenCalledWith({ graceful: true });
  });

  it('stop before start touches nothing', async () => {
    const queue = makeQueue();
    await queue.stop();
    expect(bossMock.stop).not.toHaveBeenCalled();
  });

  it('a failed stop can be retried', async () => {
    const queue = makeQueue();
    await queue.start();
    bossMock.stop.mockImplementationOnce(async () => {
      throw new Error('shutdown interrupted');
    });
    await expect(queue.stop()).rejects.toThrow('shutdown interrupted');
    await queue.stop();
    expect(bossMock.stop).toHaveBeenCalledTimes(2);
  });

  it('stays stoppable when the cleanup stop of a failed boot also fails', async () => {
    storedQueues.set('issue', 'short');
    const queue = makeQueue();
    queue.register('issue', async () => undefined);
    bossMock.stop.mockImplementationOnce(async () => {
      throw new Error('cleanup stop failed');
    });
    await expect(queue.start()).rejects.toThrow(JobQueueError);
    await expect(queue.start()).rejects.toThrow('a shutdown failed partway; retry stop()');
    await queue.stop();
    expect(bossMock.stop).toHaveBeenCalledTimes(2);
  });

  it('refuses to start over a failed shutdown until stop succeeds', async () => {
    const queue = makeQueue();
    await queue.start();
    bossMock.stop.mockImplementationOnce(async () => {
      throw new Error('shutdown interrupted');
    });
    await expect(queue.stop()).rejects.toThrow('shutdown interrupted');
    await expect(queue.start()).rejects.toThrow('a shutdown failed partway; retry stop()');
    await queue.stop();
    await queue.start();
    expect(bossMock.start).toHaveBeenCalledTimes(2);
  });

  it('creates the dead-letter queue and links it to the registered queue', async () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined, { deadLetterQueue: 'ops.dead-letters' });
    await queue.start();
    expect(bossMock.createQueue).toHaveBeenCalledWith('ops.dead-letters', { policy: 'standard', notify: true });
    expect(bossMock.updateQueue).toHaveBeenCalledWith('issue', { deadLetter: 'ops.dead-letters', notify: true });
  });

  it('clears a stale dead-letter link when the registration omits one', async () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined);
    await queue.start();
    expect(bossMock.updateQueue).toHaveBeenCalledWith('issue', { deadLetter: null, notify: true });
  });

  it('fails start when an existing queue carries a policy the registration contradicts', async () => {
    storedQueues.set('issue', 'standard');
    const queue = makeQueue();
    queue.register('issue', async () => undefined, { dedupeWaiting: true });
    await expect(queue.start()).rejects.toThrow("queue 'issue' is 'standard' but this use needs 'short'");
  });

  it('starts no worker when any registration fails validation', async () => {
    storedQueues.set('second', 'short');
    const queue = makeQueue();
    queue.register('first', async () => undefined);
    queue.register('second', async () => undefined);
    await expect(queue.start()).rejects.toThrow(JobQueueError);
    expect(bossMock.work).not.toHaveBeenCalled();
  });

  it('releases the underlying boss when start fails partway', async () => {
    storedQueues.set('issue', 'standard');
    const queue = makeQueue();
    queue.register('issue', async () => undefined, { dedupeWaiting: true });
    await expect(queue.start()).rejects.toThrow();
    expect(bossMock.stop).toHaveBeenCalledWith({ graceful: false });
  });

  it('maps concurrency to independent workers, never a settlement batch', async () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined, { concurrency: 7, perKeyConcurrency: 2 });
    await queue.start();
    expect(bossMock.work).toHaveBeenCalledWith(
      'issue',
      {
        includeMetadata: true,
        perJobResults: true,
        batchSize: 1,
        pollingIntervalSeconds: 0.5,
        notifyPollingIntervalSeconds: 0.5,
        localConcurrency: 7,
        localGroupConcurrency: 2,
      },
      expect.any(Function),
    );
  });

  it('defaults to a single worker with no group cap', async () => {
    const queue = makeQueue();
    queue.register('issue', async () => undefined);
    await queue.start();
    const options = bossMock.work.mock.calls[0]?.[1] as object;
    expect(options).toEqual({
      includeMetadata: true,
      perJobResults: true,
      batchSize: 1,
      pollingIntervalSeconds: 0.5,
      notifyPollingIntervalSeconds: 0.5,
    });
  });
});

describe('handler context and settlement', () => {
  const startWithHandler = async (
    handler: (payload: object, context: object) => Promise<void>,
    queueOptions: object = {},
  ) => {
    const queue = makeQueue(queueOptions);
    queue.register('issue', handler);
    await queue.start();
    return capturedWorkCallback();
  };

  it('hands the handler a 1-based attempt and final-attempt flag', async () => {
    const contexts: object[] = [];
    const callback = await startWithHandler(async (_payload, context) => {
      contexts.push(context);
    });
    await callback([job({ retryCount: 0, retryLimit: 2 })]);
    await callback([job({ retryCount: 1, retryLimit: 2 })]);
    await callback([job({ retryCount: 2, retryLimit: 2 })]);
    expect(contexts).toMatchObject([
      { attempt: 1, isFinalAttempt: false },
      { attempt: 2, isFinalAttempt: false },
      { attempt: 3, isFinalAttempt: true },
    ]);
  });

  it('treats a retry limit of zero as final on the first attempt', async () => {
    const contexts: object[] = [];
    const callback = await startWithHandler(async (_payload, context) => {
      contexts.push(context);
    });
    await callback([job({ retryCount: 0, retryLimit: 0 })]);
    expect(contexts).toMatchObject([{ attempt: 1, isFinalAttempt: true }]);
  });

  it('settles a successful job as completed with its id', async () => {
    const callback = await startWithHandler(async () => undefined);
    await expect(callback([job({ id: 'job-9' })])).resolves.toEqual([{ id: 'job-9', status: 'completed' }]);
  });

  it('settles a throwing job as failed and persists none of the exception text', async () => {
    const onError = jest.fn();
    const callback = await startWithHandler(
      async () => {
        throw new Error('vc service at https://vckit.internal:3332 refused token abc123');
      },
      { onError },
    );
    const results = (await callback([job()])) as object[];
    expect(results).toEqual([{ id: 'job-1', status: 'failed' }]);
    expect(JSON.stringify(results)).not.toContain('vckit.internal');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('refused') }));
  });

  it('routes a non-Error throw to the error channel as an Error naming the job', async () => {
    const onError = jest.fn();
    const callback = await startWithHandler(
      async () => {
        throw 'plain string failure';
      },
      { onError },
    );
    await expect(callback([job()])).resolves.toEqual([{ id: 'job-1', status: 'failed' }]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('plain string failure') }),
    );
  });

  it('settles each job of a batch on its own outcome', async () => {
    const callback = await startWithHandler(
      async (payload) => {
        if ((payload as { fail?: boolean }).fail) throw new Error('one bad item');
      },
      { onError: jest.fn() },
    );
    await expect(
      callback([
        job({ id: 'ok-1', data: {} }),
        job({ id: 'bad', data: { fail: true } }),
        job({ id: 'ok-2', data: {} }),
      ]),
    ).resolves.toEqual([
      { id: 'ok-1', status: 'completed' },
      { id: 'bad', status: 'failed' },
      { id: 'ok-2', status: 'completed' },
    ]);
  });

  it('hands the handler the job payload as delivered by the queue', async () => {
    const payloads: object[] = [];
    const callback = await startWithHandler(async (payload) => {
      payloads.push(payload);
    });
    await callback([job({ data: { tenantId: 't1', recordId: 'r7' } })]);
    expect(payloads).toEqual([{ tenantId: 't1', recordId: 'r7' }]);
  });
});

describe('scheduling', () => {
  it('schedules on the queue and passes the cron and payload through', async () => {
    const queue = makeQueue();
    await queue.schedule('cvc-refresh', '0 3 * * *', { source: 'cron' });
    expect(bossMock.createQueue).toHaveBeenCalledWith('cvc-refresh', { policy: 'standard', notify: true });
    expect(bossMock.schedule).toHaveBeenCalledWith('cvc-refresh', '0 3 * * *', { source: 'cron' }, {});
  });

  it('rejects scheduling a queue declared as deduplicating', async () => {
    const queue = makeQueue();
    await queue.enqueue('cvc-refresh', {}, { dedupeKey: 'k' });
    await expect(queue.schedule('cvc-refresh', '0 3 * * *')).rejects.toThrow(
      "queue 'cvc-refresh' is 'short' but this use needs 'standard'",
    );
    expect(bossMock.schedule).not.toHaveBeenCalled();
  });

  it('unschedules by name', async () => {
    const queue = makeQueue();
    await queue.unschedule('cvc-refresh');
    expect(bossMock.unschedule).toHaveBeenCalledWith('cvc-refresh');
  });
});
