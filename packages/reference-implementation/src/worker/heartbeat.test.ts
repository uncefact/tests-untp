import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QueueProbe } from '@/lib/jobs/types';
import { startHeartbeat } from './heartbeat';

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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
      logger: log as never,
      path: file,
      intervalMs: 1_000,
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
});
