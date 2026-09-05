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
/**
 * How long a consumer may report a job in hand before that stops counting
 * as work. An attempt expires at 120 s (VERIFY_JOB_ENQUEUE_OPTIONS), and
 * pg-boss keeps a consumer's job count when a settlement throws, so a count
 * older than this is a retained count after a failure, not a running job.
 */
export const HEARTBEAT_MAX_JOB_MS = 180_000;

export interface HeartbeatOptions {
  /** Proves the queue can still work; rejects when it cannot. */
  probe: () => Promise<QueueProbe>;
  logger: Logger;
  path?: string;
  intervalMs?: number;
  probeTimeoutMs?: number;
  staleFetchMs?: number;
  maxJobMs?: number;
  /** Injected for tests; the real clock otherwise. */
  now?: () => number;
}

export interface Heartbeat {
  /** Stops proving. The last proof stays on disk so a draining worker keeps reading healthy for its bounded shutdown. */
  stop(): void;
}

/**
 * The worker's health signal (#985). A worker binds no port, so the container
 * cannot probe it over HTTP, and an idle worker looks like a dead one to any
 * check of queue activity. Instead the worker proves itself: every interval
 * it runs the probe (a trivial query through the queue's own pool, and what
 * its consumers have done lately) and, when the pool answers and a consumer
 * has fetched recently or is inside a job, publishes a fresh heartbeat file.
 * The container health check fails when that file is older than a few
 * intervals, which catches a wedged event loop, a queue pool that is down or
 * exhausted, and a consumer that has stopped fetching.
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
  const maxJobMs = options.maxJobMs ?? HEARTBEAT_MAX_JOB_MS;
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

  /** Rejects when the probe has not answered in time. The probe itself keeps running; nothing cancels it. */
  const bounded = (attempt: Promise<QueueProbe>): Promise<QueueProbe> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`health probe did not answer within ${probeTimeoutMs} ms`)),
          probeTimeoutMs,
        );
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  };

  const beat = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    // inFlight is cleared by the probe itself, not by the bounded wait below,
    // so a probe that outlives its timeout still blocks the next one and
    // unanswered probes never pile up on the pool.
    const attempt = options.probe();
    const settled = () => {
      inFlight = false;
    };
    void attempt.then(settled, settled);
    try {
      const result = await bounded(attempt);
      if (stopped) return;
      if (judge(result) === 'pending') {
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
