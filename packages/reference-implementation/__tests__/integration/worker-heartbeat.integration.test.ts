/**
 * The worker heartbeat against real Postgres, a real pg-boss queue and a real
 * Prisma client. It protects the operator's signal that a worker whose
 * application database pool cannot answer stops certifying itself, even
 * while the queue's own pool answers, and certifies itself again once the
 * pool is released. The unit cases mock both probes; this one exhausts a
 * real Prisma pool while a real pg-boss pool on the same database answers.
 *
 * Unlike the rest of the suite, the Prisma client here is not built through
 * `createRigClient`. It needs a pool of exactly one connection, so its URL is
 * the rig's own `RI_DATABASE_URL` with `connection_limit=1` added, which lets
 * one held transaction exhaust the pool. `pool_timeout=1` makes a query that
 * waits for that connection reject after about a second, so every beat during
 * the hold fails with the pool's own error rather than stranding on it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '../../src/lib/prisma/generated/index.js';
import { barrier } from './rig/locks';
import { waitFor } from './rig/wait-for';
import { PgBossJobQueue } from '../../src/lib/jobs/pg-boss-job-queue';
import { startHeartbeat, type Heartbeat } from '../../src/worker/heartbeat';

const TEST_QUEUE = 'integration.worker-heartbeat';

function onePoolConnectionUrl(): string {
  const url = new URL(process.env.RI_DATABASE_URL as string);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '1');
  return url.toString();
}

const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const warnings = () => log.warn.mock.calls.map(([fields]) => (fields as { err: Error }).err);

describe('the worker heartbeat with a real queue and a one-connection Prisma pool', () => {
  let client: PrismaClient;
  let queue: PgBossJobQueue;
  let heartbeat: Heartbeat | undefined;
  let dir: string;
  let file: string;
  const queueErrors: Error[] = [];

  beforeAll(async () => {
    client = new PrismaClient({ datasourceUrl: onePoolConnectionUrl() });
    queue = new PgBossJobQueue({
      connectionString: process.env.RI_DATABASE_URL as string,
      onError: (error) => queueErrors.push(error),
    });
    // A registered handler gives the queue a consumer that fetches, which
    // the heartbeat's queue probe needs before it will publish.
    queue.register(TEST_QUEUE, async () => undefined);
    await queue.start();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-heartbeat-'));
    file = path.join(dir, 'beat');
  });

  afterAll(async () => {
    heartbeat?.stop();
    // Each step runs even when the one before it throws, so a failed queue
    // stop never leaves the Prisma pool open or the temporary directory behind.
    try {
      await queue.stop();
    } finally {
      try {
        await client.$disconnect();
      } finally {
        if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(queueErrors).toEqual([]);
  });

  it('stops publishing while the only Prisma connection is held, names the database, and publishes again once it is released', async () => {
    heartbeat = startHeartbeat({
      probe: () => queue.probe(),
      databaseProbe: async () => {
        await client.$queryRaw`SELECT 1`;
      },
      logger: log as never,
      path: file,
      intervalMs: 200,
      probeTimeoutMs: 3_000,
      maxJobMs: 60_000,
    });
    // The container health check reads the file's modification time, so this does too.
    const stamp = () => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : null);

    // 1. The file appears and its stamp advances.
    const firstStamp = await waitFor(
      async () => stamp(),
      (value) => value !== null,
    );
    await waitFor(
      async () => stamp(),
      (value) => value !== null && firstStamp !== null && value > firstStamp,
    );

    // 2. Hold the only Prisma connection inside an interactive transaction.
    // The barrier opens only after a query has run inside it, so the
    // connection is checked out before anything is asserted.
    const checkedOut = barrier();
    const hold = barrier();
    const transaction = client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        checkedOut.release();
        await hold.promise;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    // A transaction that fails before it holds the connection reports its own
    // error here rather than leaving the barrier shut until the suite timeout.
    const finished = transaction.then(() => 'finished' as const);
    finished.catch(() => undefined);
    try {
      const first = await Promise.race([checkedOut.promise.then(() => 'held' as const), finished]);
      if (first !== 'held') throw new Error('the transaction finished before it held the connection');
      // The queue's own pool still answers, so a failure below is the database probe's.
      await expect(queue.probe()).resolves.toEqual(expect.objectContaining({ consumers: expect.any(Array) }));

      // 3. Beats fail while it is held, each naming the database probe, and
      // the stamp does not advance between two failed beats.
      const before = warnings().length;
      await waitFor(
        async () => warnings().length,
        (count) => count >= before + 1,
      );
      const heldStamp = stamp();
      const afterFirst = warnings().length;
      await waitFor(
        async () => warnings().length,
        (count) => count >= afterFirst + 1,
      );
      expect(stamp()).toBe(heldStamp);
      for (const err of warnings().slice(before)) {
        expect(err.message).toBe('the database probe failed');
        expect(err.cause).toBeInstanceOf(Error);
      }
    } finally {
      // 4. Release the transaction.
      hold.release();
      await transaction;
    }

    // A new publication follows, with the recovery line.
    const releasedAt = stamp();
    await waitFor(
      async () => stamp(),
      (value) => value !== null && releasedAt !== null && value > releasedAt,
    );
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ path: file }), 'Health probe succeeding again');
  });
});
