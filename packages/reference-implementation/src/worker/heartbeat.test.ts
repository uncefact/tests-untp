import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QueueProbe } from '@/lib/jobs/types';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { startHeartbeat } from './heartbeat';

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
// Enough microtask turns for a beat to settle both probes (each wrapped in an
// async call, and a thenable adds turns of its own), judge and publish.
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const consumer = (fields: Partial<import('@/lib/jobs/types').ConsumerProbe>) => ({
  lastFetchedOn: null,
  activeJobs: 0,
  lastJobStartedOn: null,
  ...fields,
});
const working = (now: number): QueueProbe => ({ consumers: [consumer({ lastFetchedOn: now - 1_000 })] });

describe('startHeartbeat', () => {
  let file: string;
  let clock: number;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-')), 'beat');
    clock = 1_700_000_000_000;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const start = (probe: () => Promise<QueueProbe>, extra: Record<string, unknown> = {}, log = logger()) =>
    startHeartbeat({
      probe,
      databaseProbe: async () => undefined,
      logger: log as never,
      path: file,
      intervalMs: 1_000,
      maxJobMs: 300_000,
      now: () => clock,
      ...extra,
    });
  const tick = async (ms: number) => {
    clock += ms;
    await jest.advanceTimersByTimeAsync(ms);
  };

  it('publishes at once and on every interval while the probe proves a working consumer, with an advancing stamp', async () => {
    let probes = 0;
    const beat = start(async () => {
      probes += 1;
      return working(clock);
    });
    await flush();
    const first = fs.statSync(file).mtimeMs;
    await tick(3_000);
    expect(probes).toBe(4);
    expect(fs.statSync(file).mtimeMs).toBeGreaterThan(first);
    expect(fs.readFileSync(file, 'utf8')).toBe(new Date(clock).toISOString());
    beat.stop();
  });

  it('does not refresh the proof while the probe rejects, warns each time with the path, and recovers', async () => {
    const log = logger();
    let fail = false;
    const beat = start(
      async () => {
        if (fail) throw new Error('pool gone');
        return working(clock);
      },
      {},
      log,
    );
    await flush();
    const first = fs.statSync(file).mtimeMs;
    fail = true;
    await tick(3_000);
    expect(fs.statSync(file).mtimeMs).toBe(first);
    expect(log.warn).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ consecutiveFailures: 3, path: file }),
      'Health probe failed; the heartbeat is not refreshed',
    );
    fail = false;
    await tick(1_000);
    expect(fs.statSync(file).mtimeMs).toBeGreaterThan(first);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ path: file }), 'Health probe succeeding again');
    beat.stop();
  });

  it('judges a consumer that has stopped fetching as not working even though the pool answers', async () => {
    const log = logger();
    const beat = start(async () => ({ consumers: [consumer({ lastFetchedOn: clock - 31_000 })] }), {}, log);
    await flush();
    expect(fs.existsSync(file)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: expect.stringContaining('no consumer has fetched for 31 s') }),
      }),
      'Health probe failed; the heartbeat is not refreshed',
    );
    beat.stop();
  });

  it('a consumer that has not fetched yet is not yet proven: no proof and no warning inside the window, a failure after it', async () => {
    // queue.start() returns before the first fetch; a fresh worker must not
    // log a spurious failure, and must not publish a proof it does not have.
    // Fails if the allowance publishes, or is dropped, or is made permanent.
    const log = logger();
    const beat = start(async () => ({ consumers: [consumer({})] }), {}, log);
    await flush();
    expect(fs.existsSync(file)).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    for (let i = 0; i < 30; i += 1) await tick(1_000);
    expect(fs.existsSync(file)).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    await tick(1_000);
    await tick(1_000);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'no consumer has fetched yet' }) }),
      'Health probe failed; the heartbeat is not refreshed',
    );
    beat.stop();
  });

  it("a stale consumer's retained job count beside an idle consumer's fresh timestamp does not add up to working", async () => {
    // With concurrency four the consumers are judged one by one; an
    // aggregate would let a failed consumer's phantom job pair with another
    // consumer's recent empty fetch. Fails if the probe is aggregated again.
    const log = logger();
    const beat = start(
      async () => ({
        consumers: [
          consumer({ lastFetchedOn: clock - 631_000, activeJobs: 1, lastJobStartedOn: clock - 631_000 }),
          consumer({ lastFetchedOn: clock - 31_000, activeJobs: 0, lastJobStartedOn: clock - 31_000 }),
        ],
      }),
      {},
      log,
    );
    await flush();
    expect(fs.existsSync(file)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: expect.stringContaining('no consumer has fetched for 31 s') }),
      }),
      'Health probe failed; the heartbeat is not refreshed',
    );
    beat.stop();
  });

  it('one consumer inside a recent job is enough, whatever the others report', async () => {
    const beat = start(async () => ({
      consumers: [
        consumer({ lastFetchedOn: clock - 631_000, activeJobs: 1, lastJobStartedOn: clock - 631_000 }),
        consumer({ lastFetchedOn: clock - 90_000, activeJobs: 1, lastJobStartedOn: clock - 60_000 }),
      ],
    }));
    await flush();
    expect(fs.existsSync(file)).toBe(true);
    beat.stop();
  });

  it('a consumer inside a recently started job counts as working however long ago it last fetched', async () => {
    const beat = start(async () => ({
      consumers: [consumer({ lastFetchedOn: clock - 600_000, activeJobs: 1, lastJobStartedOn: clock - 60_000 })],
    }));
    await flush();
    expect(fs.existsSync(file)).toBe(true);
    beat.stop();
  });

  it('a job count older than an attempt can live is a retained count after a failed settlement, not work', async () => {
    // pg-boss keeps jobs.length when onFetch rejects; a failed consumer would
    // otherwise be certified for ever by its phantom job. Fails if the age
    // bound on activeJobs is dropped.
    const log = logger();
    const beat = start(
      async () => ({
        consumers: [consumer({ lastFetchedOn: clock - 600_000, activeJobs: 1, lastJobStartedOn: clock - 600_000 })],
      }),
      {},
      log,
    );
    await flush();
    expect(fs.existsSync(file)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: expect.stringContaining('no consumer has fetched for 600 s and none holds a recently started job'),
        }),
      }),
      'Health probe failed; the heartbeat is not refreshed',
    );
    beat.stop();
  });

  it('a probe that never answers is a failure at the probe timeout, and no second probe starts until it settles', async () => {
    const log = logger();
    let probes = 0;
    const beat = start(
      () => {
        probes += 1;
        return new Promise(() => undefined);
      },
      { intervalMs: 1_000, probeTimeoutMs: 500 },
      log,
    );
    await tick(500);
    await flush();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: expect.stringContaining('did not answer within 500 ms') }),
      }),
      'Health probe failed; the heartbeat is not refreshed',
    );
    await tick(3_000);
    expect(probes).toBe(1);
    beat.stop();
  });

  it('a failed publication counts as a failed beat and leaves the previous proof, content and stamp, untouched', async () => {
    const log = logger();
    const beat = start(async () => working(clock), {}, log);
    await flush();
    const before = { mtime: fs.statSync(file).mtimeMs, content: fs.readFileSync(file, 'utf8') };
    const dir = path.dirname(file);
    fs.chmodSync(dir, 0o500); // the next publication cannot create its temporary file
    try {
      await tick(1_000);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveFailures: 1,
          err: expect.objectContaining({
            message: expect.stringContaining(`could not publish the heartbeat at ${file}`),
          }),
        }),
        'Health probe failed; the heartbeat is not refreshed',
      );
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(before.mtime);
    expect(fs.readFileSync(file, 'utf8')).toBe(before.content);
    beat.stop();
  });

  it("removes a previous process's proof at start so it never certifies this one", async () => {
    fs.writeFileSync(file, 'stale');
    const beat = start(() => new Promise(() => undefined), { probeTimeoutMs: 100 });
    expect(fs.existsSync(file)).toBe(false);
    beat.stop();
  });

  it('stop ends proving but keeps the last proof, and a probe resolving after stop does not publish', async () => {
    let release: (probe: QueueProbe) => void = () => undefined;
    let calls = 0;
    const beat = start(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve(working(clock)) : new Promise((resolve) => (release = resolve));
    });
    await flush();
    const first = fs.statSync(file).mtimeMs;
    await tick(1_000);
    beat.stop();
    clock += 5_000;
    release(working(clock));
    await flush();
    expect(fs.statSync(file).mtimeMs).toBe(first);
    await tick(5_000);
    expect(calls).toBe(2);
  });
  describe('the database probe beside the queue probe', () => {
    // The worker's handlers use the application's Prisma pool, which the
    // queue probe never touches. These cases protect the operator's signal
    // that a worker whose Prisma pool cannot answer reads unhealthy, and the
    // log line that says which pool failed.
    const after = <T>(ms: number, value: () => T): Promise<T> =>
      new Promise((resolve) => setTimeout(() => resolve(value()), ms));
    const failAfter = (ms: number, message: string): Promise<never> =>
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
    const warnedWith = (log: ReturnType<typeof logger>) => log.warn.mock.calls.map(([fields]) => fields.err as Error);

    it('a working queue and a database probe that rejects: no refresh, a warning naming the database, then recovery', async () => {
      // Fails if the heartbeat publishes on the queue probe alone.
      const log = logger();
      let databaseDown = false;
      const refused = new Error('connection refused');
      const beat = start(
        async () => working(clock),
        {
          databaseProbe: async () => {
            if (databaseDown) throw refused;
          },
        },
        log,
      );
      await flush();
      const first = fs.statSync(file).mtimeMs;
      databaseDown = true;
      await tick(2_000);
      expect(fs.statSync(file).mtimeMs).toBe(first);
      expect(log.warn).toHaveBeenCalledTimes(2);
      expect(log.warn).toHaveBeenLastCalledWith(
        expect.objectContaining({ consecutiveFailures: 2, path: file }),
        'Health probe failed; the heartbeat is not refreshed',
      );
      const err = warnedWith(log)[1];
      expect(err.message).toBe('the database probe failed');
      expect(err.cause).toBe(refused);
      databaseDown = false;
      await tick(1_000);
      expect(fs.statSync(file).mtimeMs).toBeGreaterThan(first);
      expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ path: file }), 'Health probe succeeding again');
      beat.stop();
    });

    it('holds the next beat until both probes settle when the database probe fails fast and the queue probe is slow', async () => {
      // Fails if the guard is released by the first probe to settle
      // (Promise.all or Promise.race), which would pile probes on the slow pool.
      const log = logger();
      let queueCalls = 0;
      let databaseCalls = 0;
      const beat = start(
        () => {
          queueCalls += 1;
          return after(4_000, () => working(clock));
        },
        {
          databaseProbe: () => {
            databaseCalls += 1;
            return failAfter(100, 'connection refused');
          },
        },
        log,
      );
      await tick(3_900);
      expect(queueCalls).toBe(1);
      expect(databaseCalls).toBe(1);
      expect(log.warn).not.toHaveBeenCalled();
      await tick(100);
      await flush();
      expect(warnedWith(log)[0].message).toBe('the database probe failed');
      expect(fs.existsSync(file)).toBe(false);
      await tick(1_000);
      expect(queueCalls).toBe(2);
      expect(databaseCalls).toBe(2);
      beat.stop();
    });

    it('holds the next beat until both probes settle when the queue probe fails fast and the database probe is slow', async () => {
      const log = logger();
      let queueCalls = 0;
      let databaseCalls = 0;
      const beat = start(
        () => {
          queueCalls += 1;
          return failAfter(100, 'pool gone');
        },
        {
          databaseProbe: () => {
            databaseCalls += 1;
            return after(4_000, () => undefined);
          },
        },
        log,
      );
      await tick(3_900);
      expect(queueCalls).toBe(1);
      expect(databaseCalls).toBe(1);
      await tick(100);
      await flush();
      expect(warnedWith(log)[0].message).toBe('the job queue probe failed');
      await tick(1_000);
      expect(queueCalls).toBe(2);
      expect(databaseCalls).toBe(2);
      beat.stop();
    });

    it('runs both probes at once under one limit, so two 3 second probes publish', async () => {
      // Run one after the other they would take 6 seconds and miss the
      // 5 second limit. Fails if the probes are made sequential.
      const log = logger();
      const beat = start(
        () => after(3_000, () => working(clock)),
        { databaseProbe: () => after(3_000, () => undefined) },
        log,
      );
      await tick(3_000);
      await flush();
      expect(fs.existsSync(file)).toBe(true);
      expect(log.warn).not.toHaveBeenCalled();
      beat.stop();
    });

    it('a database answer that arrives after the limit does not publish', async () => {
      // Fails if a late settlement certifies a beat that has already failed.
      const log = logger();
      const beat = start(async () => working(clock), { databaseProbe: () => after(6_000, () => undefined) }, log);
      await tick(5_000);
      await flush();
      expect(log.warn).toHaveBeenCalledTimes(1);
      await tick(1_000);
      await flush();
      await tick(500);
      expect(fs.existsSync(file)).toBe(false);
      beat.stop();
    });

    it.each(['job queue', 'database'] as const)(
      'a %s probe that throws before returning a promise fails the beat, and the next beat still runs',
      async (pool) => {
        // Fails if a probe is called raw: the throw escapes the beat with the
        // guard held, so nothing is logged and no beat ever runs again.
        const log = logger();
        const thrown = new Error('client not connected');
        let calls = 0;
        const throwing = (): never => {
          calls += 1;
          throw thrown;
        };
        const beat =
          pool === 'database'
            ? start(async () => working(clock), { databaseProbe: throwing }, log)
            : start(throwing, {}, log);
        await flush();
        expect(fs.existsSync(file)).toBe(false);
        expect(warnedWith(log)[0].message).toBe(`the ${pool} probe failed`);
        expect(warnedWith(log)[0].cause).toBe(thrown);
        await tick(1_000);
        expect(calls).toBe(2);
        beat.stop();
      },
    );
  });

  describe('the warning as the log renders it', () => {
    // The operator reads the rendered line, not the error object. The log
    // serialiser appends each cause's message to the error's own, so these
    // cases run the real logger and protect the operator's reading that each
    // failure's reason appears once and each pool is named.
    const hangs = () => new Promise<never>(() => undefined);
    const rejects = (message: string) => async () => {
      throw new Error(message);
    };
    it.each([
      {
        name: 'the database probe rejects',
        probe: async () => working(clock),
        databaseProbe: rejects('connection refused'),
        rendered: 'the database probe failed: connection refused',
      },
      {
        name: 'the job queue probe rejects',
        probe: rejects('pool gone'),
        databaseProbe: async () => undefined,
        rendered: 'the job queue probe failed: pool gone',
      },
      {
        name: 'both probes reject',
        probe: rejects('pool gone'),
        databaseProbe: rejects('connection refused'),
        rendered: 'the job queue probe failed: pool gone; the database probe failed: connection refused',
      },
      {
        name: 'the database probe never answers',
        probe: async () => working(clock),
        databaseProbe: hangs,
        rendered: 'health probe did not answer within 5000 ms (job queue: answered; database: no answer)',
      },
      {
        name: 'the job queue probe rejects and the database probe never answers',
        probe: rejects('pool gone'),
        databaseProbe: hangs,
        rendered: 'health probe did not answer within 5000 ms (job queue: failed; database: no answer): pool gone',
      },
      {
        name: 'the job queue probe never answers',
        probe: hangs,
        databaseProbe: async () => undefined,
        rendered: 'health probe did not answer within 5000 ms (job queue: no answer; database: answered)',
      },
      {
        name: 'neither probe answers',
        probe: hangs,
        databaseProbe: hangs,
        rendered: 'health probe did not answer within 5000 ms (job queue: no answer; database: no answer)',
      },
      {
        name: 'the job queue probe never answers and the database probe rejects',
        probe: hangs,
        databaseProbe: rejects('connection refused'),
        rendered:
          'health probe did not answer within 5000 ms (job queue: no answer; database: failed): connection refused',
      },
    ])('$name', async ({ probe, databaseProbe, rendered }) => {
      const lines: string[] = [];
      const log = createLogger({ level: 'debug', destination: { write: (line: string) => lines.push(line) } });
      const beat = start(probe as () => Promise<QueueProbe>, { databaseProbe }, log as never);
      await flush();
      await tick(5_000);
      await flush();
      beat.stop();
      const warned = lines
        .map((line) => JSON.parse(line) as { msg: string; err?: { message: string } })
        .filter((entry) => entry.msg === 'Health probe failed; the heartbeat is not refreshed');
      expect(warned[0]?.err?.message).toBe(rendered);
    });
  });
});
