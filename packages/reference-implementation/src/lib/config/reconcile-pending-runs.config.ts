import { CronExpressionParser } from 'cron-parser';

export const DEFAULT_RECONCILE_PENDING_RUNS_CRON = '*/10 * * * *';
export const DEFAULT_RECONCILE_PENDING_RUNS_BATCH_SIZE = 500;
/** One tick loads this many rows into memory before settling them one by one. */
export const MAX_RECONCILE_PENDING_RUNS_BATCH_SIZE = 10_000;

/**
 * LIBRARY_RECONCILE_PENDING_RUNS_CRON sets how often the worker sweeps for
 * pending verification generations that outlived their queue job. The sweep
 * only settles generations older than a cutoff derived from the verify job's
 * whole retry ladder, so the cadence bounds how long a lost generation waits
 * after it became eligible and cannot settle one whose worker is still
 * retrying. Unset or blank uses the default. A provided value is parsed with
 * the same cron-parser call pg-boss makes when it records a schedule
 * (`Timekeeper.schedule`, pg-boss 12.29.0, `strict: false`), so what is
 * accepted here is exactly what the queue will accept, and a value the
 * parser rejects throws at worker boot with the parser's reason and the
 * variable named.
 */
export function readReconcilePendingRunsCron(env: Record<string, string | undefined> = process.env): string {
  const raw = env.LIBRARY_RECONCILE_PENDING_RUNS_CRON;
  if (raw === undefined || raw.trim() === '') return DEFAULT_RECONCILE_PENDING_RUNS_CRON;
  const cron = raw.trim();
  try {
    CronExpressionParser.parse(cron, { tz: 'UTC', strict: false });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `LIBRARY_RECONCILE_PENDING_RUNS_CRON is not a cron expression the queue can schedule (${reason}); fix or unset it (unset uses ${DEFAULT_RECONCILE_PENDING_RUNS_CRON}).`,
    );
  }
  return cron;
}

/**
 * LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE caps how many abandoned
 * generations one sweep tick settles, oldest first. The next tick takes the
 * rest. The cap exists so one tick over a large backlog cannot load and
 * settle every row inside one job attempt, which is also why the value has a
 * ceiling. Unset or blank uses the default. A provided value that is not a
 * positive integer within the ceiling throws at worker boot with this message.
 */
export function readReconcilePendingRunsBatchSize(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE;
  if (raw === undefined || raw.trim() === '') return DEFAULT_RECONCILE_PENDING_RUNS_BATCH_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RECONCILE_PENDING_RUNS_BATCH_SIZE) {
    throw new Error(
      `LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE must be a positive integer no greater than ${MAX_RECONCILE_PENDING_RUNS_BATCH_SIZE} when set; fix or unset it (unset uses ${DEFAULT_RECONCILE_PENDING_RUNS_BATCH_SIZE}).`,
    );
  }
  return parsed;
}
