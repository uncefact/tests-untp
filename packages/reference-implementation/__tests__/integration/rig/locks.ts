import type { Prisma, PrismaClient } from '../../../src/lib/prisma/generated/index.js';
import { createRigClient } from './db';

export type LockTarget =
  | { table: 'LibraryRecord'; id: string; tenantId: string }
  | { table: 'CheckRun'; id: string; tenantId: string };

export type LockHolder = { pid: number; release: () => void; done: Promise<void> };

export function barrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Holds one known row lock until the caller releases it. The caller owns the
 * holder's lifecycle, so this rig helper has no hooks or shared connections.
 * The holder's pid is reported from inside the transaction once the lock is
 * actually held, and nothing proceeds past the returned promise until then,
 * so a schedule built on it is observed rather than assumed. A suite must
 * release every holder it made (in `afterEach`, `finally` or by awaiting its
 * outcome), because a failed wait must not leave a transaction holding the
 * row: the next truncation would queue behind it until the 20 s timeout.
 */
export async function holdRowForUpdate(client: PrismaClient, target: LockTarget): Promise<LockHolder> {
  const table = target.table;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalLocked!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => {
    signalLocked = resolve;
  });
  const done = client.$transaction(
    async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "${table}" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE`,
        target.id,
        target.tenantId,
      );
      if (rows.length !== 1) throw new Error(`${table} ${target.id} was not found for the lock holder`);
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      signalLocked(backend.pid);
      await hold;
    },
    { timeout: 20_000 },
  );
  const settled = done.then(() => undefined);
  const pid = await Promise.race([
    locked,
    settled.then(() => {
      throw new Error(`the ${table} lock holder finished before it reported holding the lock`);
    }),
  ]);
  return { pid, release, done: settled };
}

/**
 * Resolves once `expected` backends are queued behind the holder, read from
 * the database rather than waited out, so a schedule is observed and never
 * assumed from elapsed time. Waiting for one writer before queueing the next
 * is what puts them in the queue in a known order.
 *
 * The walk is recursive because `pg_blocking_pids` reports the process a
 * backend is directly waiting on: only the first waiter for a row waits on the
 * lock holder's transaction, and every later one waits on the tuple lock the
 * waiter ahead of it holds. Counting direct blockers alone would therefore
 * never see more than one waiter, however long it waited. The count covers
 * every backend on the database, so a suite must be the only writer on its
 * rig while it waits.
 */
export async function waitForQueueBehind(
  client: PrismaClient,
  holderPid: number,
  expected: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await client.$queryRaw<{ count: bigint }[]>`
      WITH RECURSIVE queued AS (
        SELECT pid FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
        UNION
        SELECT waiter.pid FROM pg_stat_activity waiter
        JOIN queued ON queued.pid = ANY(pg_blocking_pids(waiter.pid))
      )
      SELECT count(*)::bigint AS count FROM queued
    `;
    if (Number(row.count) >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`only ${row.count} backends are queued behind ${holderPid}, expected ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Runs two transactions against one row and proves that the second waits for the first. */
export async function contend<A, B>(
  client: PrismaClient,
  first: (tx: Prisma.TransactionClient) => Promise<A>,
  second: (tx: Prisma.TransactionClient) => Promise<B>,
): Promise<[A, B]> {
  const other = createRigClient();
  const firstReady = barrier();
  const secondReady = barrier();
  const commitFirst = barrier();
  let firstPid = 0;
  const firstRun = client.$transaction(
    async (tx) => {
      const [session] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      firstPid = session.pid;
      const result = await first(tx);
      firstReady.release();
      await commitFirst.promise;
      return result;
    },
    { timeout: 15_000 },
  );
  const secondRun = other.$transaction(
    async (tx) => {
      await firstReady.promise;
      secondReady.release();
      return second(tx);
    },
    { timeout: 15_000 },
  );
  const completed = Promise.all([firstRun, secondRun]);
  const drained = completed.catch(() => undefined);
  try {
    await Promise.race([secondReady.promise, completed]);
    await waitForQueueBehind(client, firstPid, 1);
    commitFirst.release();
    return await completed;
  } finally {
    firstReady.release();
    secondReady.release();
    commitFirst.release();
    await drained;
    await other.$disconnect();
  }
}
