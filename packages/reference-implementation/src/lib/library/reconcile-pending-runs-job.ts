import {
  findAbandonedPendingCheckRuns,
  settleAbandonedCheckRun,
  type CheckRunSettleOutcome,
} from '@/lib/prisma/repositories/check-run.repository';
import type { CheckRun } from '@/lib/prisma/generated';
import type { EnqueueOptions, JobHandler, JobQueue } from '@/lib/jobs/types';
import { LIBRARY_RECONCILE_PENDING_RUNS_JOB } from '@/lib/jobs/queue-names';
import { readReconcilePendingRunsBatchSize } from '@/lib/config/reconcile-pending-runs.config';
import { readWorkerJobTimeoutSeconds } from '@/lib/config/worker-job-timeout.config';
import { VERIFY_JOB_ENQUEUE_OPTIONS } from './verify-generation-job';
import { apiLogger } from '@/lib/api/logger';

const RECONCILIATION_BOUND_SECONDS = 30 * 60;
type RetryLadder = NonNullable<EnqueueOptions['retry']>;
const logger = apiLogger.child({ module: 'reconcile-pending-runs-job' });

export type ReconcilePendingRunsDependencies = {
  findAbandoned: (cutoff: Date) => Promise<CheckRun[]>;
  settleAbandoned: (run: CheckRun, cutoff: Date) => Promise<CheckRunSettleOutcome>;
  now: () => Date;
};

export function defaultReconcilePendingRunsDependencies(): ReconcilePendingRunsDependencies {
  return {
    // The cap is read per tick, so the operator's setting is what each sweep uses.
    findAbandoned: (cutoff) => findAbandonedPendingCheckRuns(cutoff, readReconcilePendingRunsBatchSize()),
    settleAbandoned: settleAbandonedCheckRun,
    now: () => new Date(Date.now()),
  };
}

/**
 * Returns the reconciliation cutoff after the complete verification retry
 * ladder has elapsed: every attempt may run to its expiry, so the expiry is
 * counted once per attempt and the longest possible backoff between them is
 * added. The elapsed ladder is rounded up to the next whole 30 minutes, with
 * 30 minutes as the floor. The bound identifies work worth inspecting, not
 * proof that its queue job is gone.
 *
 * The per-retry delay is jittered rather than a plain doubling. pg-boss
 * computes it as `LEAST(retry_delay_max, GREATEST(retry_delay, 1) * (2^n/2 +
 * 2^n/2 * random()))` for the nth retry (installed pg-boss
 * `dist/plans.js` lines 1774 to 1780), which tops out at
 * `retry_delay * 2^n` when the random term is 1. So the ladder sums those
 * maxima, not the unjittered `retry_delay * 2^(n-1)`: taking the lower figure
 * would put the cutoff inside a ladder that is still running and settle
 * generations whose worker is legitimately retrying.
 */
export function verificationAbandonmentCutoff(
  now: Date = new Date(Date.now()),
  retry: RetryLadder = VERIFY_JOB_ENQUEUE_OPTIONS.retry,
  attemptSeconds = readWorkerJobTimeoutSeconds(),
): Date {
  const retryLimit = retry.limit;
  const backoffSeconds = retry.backoffSeconds ?? 0;
  const backoffMaxSeconds = retry.backoffMaxSeconds ?? Number.POSITIVE_INFINITY;
  let retrySeconds = 0;
  for (let retryNumber = 1; retryNumber <= retryLimit; retryNumber += 1) {
    retrySeconds += Math.min(backoffSeconds * 2 ** retryNumber, backoffMaxSeconds);
  }
  const elapsedSeconds = attemptSeconds * (retryLimit + 1) + retrySeconds;
  const roundedSeconds = Math.max(
    RECONCILIATION_BOUND_SECONDS,
    Math.ceil(elapsedSeconds / RECONCILIATION_BOUND_SECONDS) * RECONCILIATION_BOUND_SECONDS,
  );
  return new Date(now.getTime() - roundedSeconds * 1000);
}

export function reconcilePendingRunsHandler(
  deps: ReconcilePendingRunsDependencies = defaultReconcilePendingRunsDependencies(),
): JobHandler<Record<string, never>> {
  return async () => {
    const cutoff = verificationAbandonmentCutoff(deps.now());
    const abandoned = await deps.findAbandoned(cutoff);
    logger.info({ cutoff, count: abandoned.length }, 'Pending verification generations selected for reconciliation');
    let settled = 0;
    let unchanged = 0;
    let failed = 0;
    for (const run of abandoned) {
      // Per row, so one row this sweep cannot settle does not abandon the
      // rest of the tick. The rows are taken oldest first, so an unwrapped
      // failure would put the same row at the head of every later tick and
      // no abandoned generation would ever settle again.
      try {
        const outcome = await deps.settleAbandoned(run, cutoff);
        if (outcome.outcome === 'applied') settled += 1;
        else unchanged += 1;
        reportSettlement(run, outcome);
      } catch (error) {
        failed += 1;
        logger.error(
          {
            err: error,
            recordId: run.recordId,
            tenantId: run.tenantId,
            generation: run.generation,
            checkRunId: run.id,
          },
          'Abandoned verification generation could not be settled; the sweep continued',
        );
      }
    }
    logger.info({ cutoff, selected: abandoned.length, settled, unchanged, failed }, 'Reconciliation sweep finished');
  };
}

function reportSettlement(run: CheckRun, outcome: CheckRunSettleOutcome): void {
  switch (outcome.outcome) {
    case 'applied':
      logger.warn(
        { recordId: run.recordId, tenantId: run.tenantId, generation: run.generation, checkRunId: run.id },
        'Abandoned verification generation settled; re-verify to run it again',
      );
      return;
    case 'superseded':
      logger.info(
        { recordId: run.recordId, tenantId: run.tenantId, generation: run.generation, checkRunId: run.id },
        'Abandoned verification generation was already settled',
      );
      return;
    case 'missing':
      logger.info(
        { recordId: run.recordId, tenantId: run.tenantId, generation: run.generation, checkRunId: run.id },
        'Abandoned verification generation no longer exists',
      );
      return;
  }
}

/** Registers the worker-only sweep. The web process never sends this queue. */
export function registerPendingRunReconciliation(
  queue: JobQueue,
  deps: ReconcilePendingRunsDependencies = defaultReconcilePendingRunsDependencies(),
): void {
  queue.register(LIBRARY_RECONCILE_PENDING_RUNS_JOB, reconcilePendingRunsHandler(deps), { concurrency: 1 });
}
