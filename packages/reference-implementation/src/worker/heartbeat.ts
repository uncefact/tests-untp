import fs from 'node:fs';
import path from 'node:path';
import type { LoggerService as Logger } from '@uncefact/untp-ri-services';
import type { QueueProbe } from '../lib/jobs/types';

/** Where the worker records that it last proved itself working; the container health check reads its age. */
export const HEARTBEAT_PATH = process.env.WORKER_HEARTBEAT_PATH || '/tmp/worker-heartbeat';
/** How often the worker proves itself. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** A probe that has not answered inside this is a failed probe. */
export const HEARTBEAT_PROBE_TIMEOUT_MS = 5_000;
/**
 * A consumer that has not fetched for this long while holding no job is not
 * working, whatever the pool says. Above the poll interval with room for a
 * slow fetch; a consumer inside a job is judged by the job's own attempt
 * budget, not by this.
 */
export const HEARTBEAT_STALE_FETCH_MS = 30_000;
export interface HeartbeatOptions {
  /** Proves the queue can still work; rejects when it cannot. */
  probe: () => Promise<QueueProbe>;
  /**
   * Proves the worker's application database pool (the Prisma client its
   * handlers use) can still run a query; rejects when it cannot. Runs beside
   * `probe` under the same time limit, and a beat publishes only when both
   * answer.
   */
  databaseProbe: () => Promise<unknown>;
  logger: Logger;
  path?: string;
  intervalMs?: number;
  probeTimeoutMs?: number;
  staleFetchMs?: number;
  /** How long a consumer may report a job in hand before it is considered stale. */
  maxJobMs: number;
  /** Injected for tests; the real clock otherwise. */
  now?: () => number;
}

/** What one probe of a beat has done so far: nothing yet, or its settlement. */
interface Observed {
  result?: PromiseSettledResult<unknown>;
}

/** Records a probe's settlement as it happens, so a timeout can say which probe answered. */
function observe(attempt: Promise<unknown>): Observed {
  const seen: Observed = {};
  void attempt.then(
    (value) => {
      seen.result = { status: 'fulfilled', value };
    },
    (reason: unknown) => {
      seen.result = { status: 'rejected', reason };
    },
  );
  return seen;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * One probe's state for a timeout message. A failure's reason is not repeated
 * here: it rides as the error's cause, which the log serialiser appends.
 */
function stateOf(seen: Observed): string {
  if (seen.result === undefined) return 'no answer';
  return seen.result.status === 'fulfilled' ? 'answered' : 'failed';
}

function isRejected(result: PromiseSettledResult<unknown> | undefined): result is PromiseRejectedResult {
  return result?.status === 'rejected';
}

export interface Heartbeat {
  /** Stops proving. The last proof stays on disk so a draining worker keeps reading healthy for its bounded shutdown. */
  stop(): void;
}

/**
 * The worker's health signal (#985). A worker binds no port, so the container
 * cannot probe it over HTTP, and an idle worker looks like a dead one to any
 * check of queue activity. Instead the worker proves itself: every interval
 * it runs two probes together, the queue probe (a trivial query through the
 * queue's own pool, and what its consumers have done lately) and the
 * database probe (a trivial query through the application's Prisma pool).
 * When both pools answer and a consumer has fetched recently or is inside a
 * job, it publishes a fresh heartbeat file. The container health check fails
 * when that file is older than a few intervals, which catches a wedged event
 * loop, either pool being down or exhausted, and a consumer that has stopped
 * fetching. A failed beat's log names the pool that failed, or on a timeout
 * each pool's state.
 *
 * The two probes share one time limit, and the next beat waits until both
 * have settled, so a probe that never settles keeps the worker unhealthy
 * until it does, whichever pool it is on.
 *
 * The worker does not exit on a failed probe. Both database pools recover a
 * lost connection on their own, so exiting would restart every worker on a
 * shared outage without repairing it, and a wedged event loop could not run
 * its own exit anyway. Unhealthy is the signal: an orchestrator's liveness
 * probe restarts on it, and under plain Docker it is what `docker ps` shows.
 *
 * Publication is atomic (a temporary file renamed into place), so a write
 * that fails part way never leaves an empty but fresh-looking file, and the
 * previous proof and its age survive. A failure to publish counts as a
 * failed beat exactly like a failed probe, and is logged with the path. Any
 * proof left by a previous process is removed at start, so a new process is
 * never certified by its predecessor's file.
 */
export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
  const file = options.path ?? HEARTBEAT_PATH;
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? HEARTBEAT_PROBE_TIMEOUT_MS;
  const staleFetchMs = options.staleFetchMs ?? HEARTBEAT_STALE_FETCH_MS;
  const maxJobMs = options.maxJobMs;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  let stopped = false;
  let inFlight = false;
  let consecutiveFailures = 0;

  try {
    fs.rmSync(file, { force: true });
  } catch (error) {
    options.logger.warn({ err: error, path: file }, 'Could not remove a previous heartbeat file');
  }

  const publish = (): void => {
    const stamp = new Date(now());
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(temporary, stamp.toISOString());
    fs.utimesSync(temporary, stamp, stamp);
    fs.renameSync(temporary, file);
  };

  /**
   * 'working' when some consumer proves it, 'pending' when no consumer has
   * fetched yet and the worker is young (queue.start() returns before the
   * consumers' first fetch), otherwise the reason it is not working. Judged
   * per consumer: a stale consumer's retained job count beside an idle
   * consumer's fresh timestamp must not add up to working.
   */
  const judge = (probe: QueueProbe): 'working' | 'pending' => {
    const at = now();
    for (const consumer of probe.consumers) {
      if (consumer.activeJobs > 0 && consumer.lastJobStartedOn !== null && at - consumer.lastJobStartedOn <= maxJobMs) {
        return 'working';
      }
      if (consumer.lastFetchedOn !== null && at - consumer.lastFetchedOn <= staleFetchMs) return 'working';
    }
    if (probe.consumers.every((consumer) => consumer.lastFetchedOn === null) && at - startedAt <= staleFetchMs) {
      return 'pending';
    }
    const newest = probe.consumers.reduce<number | null>(
      (latest, consumer) =>
        consumer.lastFetchedOn !== null && (latest === null || consumer.lastFetchedOn > latest)
          ? consumer.lastFetchedOn
          : latest,
      null,
    );
    throw new Error(
      newest === null
        ? 'no consumer has fetched yet'
        : `no consumer has fetched for ${Math.round((at - newest) / 1000)} s and none holds a recently started job`,
    );
  };

  /**
   * Rejects when the two probes have not both settled in time, naming what
   * each had done by then; a probe that had already failed is the cause. The
   * probes keep running; nothing cancels them.
   */
  const bounded = <T>(attempt: Promise<T>, queue: Observed, database: Observed): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const rejected = [queue.result, database.result].find(isRejected);
          reject(
            new Error(
              `health probe did not answer within ${probeTimeoutMs} ms (job queue: ${stateOf(
                queue,
              )}; database: ${stateOf(database)})`,
              rejected === undefined ? undefined : { cause: rejected.reason },
            ),
          );
        }, probeTimeoutMs);
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  };

  const beat = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    // inFlight is cleared when both probes have settled, not by the bounded
    // wait below and not by the first to settle, so a probe that outlives its
    // timeout still blocks the next beat and unanswered probes never pile up
    // on either pool. Each probe is called inside an async function, so a
    // probe that throws before returning still settles (and frees the guard).
    const queueAttempt = (async () => options.probe())();
    const databaseAttempt = (async () => options.databaseProbe())();
    const queueSeen = observe(queueAttempt);
    const databaseSeen = observe(databaseAttempt);
    const both = Promise.allSettled([queueAttempt, databaseAttempt]);
    void both.then(() => {
      inFlight = false;
    });
    try {
      const [queueResult, databaseResult] = await bounded(both, queueSeen, databaseSeen);
      if (stopped) return;
      // The reason rides as the cause, and the log serialiser appends a
      // cause's message to the error's own, so the message stops at "failed"
      // and the logged line reads "the database probe failed: <reason>" once.
      // When both fail, the queue's reason is written into the message and
      // the database's is the cause.
      if (queueResult.status === 'rejected' && databaseResult.status === 'rejected') {
        throw new Error(`the job queue probe failed: ${messageOf(queueResult.reason)}; the database probe failed`, {
          cause: databaseResult.reason,
        });
      }
      if (queueResult.status === 'rejected') {
        throw new Error('the job queue probe failed', { cause: queueResult.reason });
      }
      if (databaseResult.status === 'rejected') {
        throw new Error('the database probe failed', { cause: databaseResult.reason });
      }
      if (judge(queueResult.value) === 'pending') {
        // Not failed and not proven: no warning, and no proof either. The
        // container's start period covers the missing file meanwhile.
        return;
      }
      try {
        publish();
      } catch (error) {
        throw new Error(
          `could not publish the heartbeat at ${file}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      if (consecutiveFailures > 0) options.logger.info({ path: file }, 'Health probe succeeding again');
      consecutiveFailures = 0;
    } catch (error) {
      if (stopped) return;
      consecutiveFailures += 1;
      options.logger.warn(
        { err: error, consecutiveFailures, path: file },
        'Health probe failed; the heartbeat is not refreshed',
      );
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
