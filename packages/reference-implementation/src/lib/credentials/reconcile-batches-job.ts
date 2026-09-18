import { randomUUID } from 'node:crypto';
import { appLogger } from '@/lib/api/logger';
import { readReconcilePendingRunsBatchSize } from '@/lib/config/reconcile-pending-runs.config';
import { readWorkerJobTimeoutSeconds } from '@/lib/config/worker-job-timeout.config';
import { CREDENTIAL_BATCH_ISSUE_JOB, CREDENTIAL_BATCH_RECONCILE_JOB } from '@/lib/jobs/queue-names';
import type { JobHandler, JobQueue } from '@/lib/jobs/types';
import { prismaSqlExecutor } from '@/lib/jobs/prisma-sql-executor';
import {
  CREDENTIAL_BATCH_ISSUE_ENQUEUE_OPTIONS,
  CredentialBatchAttemptFenceLostError,
  claimBatchAttemptAndRelease,
  findStalledCredentialBatches,
  type StalledCredentialBatch,
  type BatchSettlementOutcome,
} from '@/lib/prisma/repositories/credential-batch.repository';
import { prisma } from '@/lib/prisma/prisma';

const logger = appLogger.child({ module: 'reconcile-credential-batches-job' });

type CredentialBatchRecoveryOutcome =
  | 'requeued'
  | 'settled'
  | 'superseded'
  | { outcome: 'unsettled'; settlement: BatchSettlementOutcome['outcome'] };

export type CredentialBatchReconciliationDependencies = {
  findStalled: (staleBefore: Date) => Promise<StalledCredentialBatch[]>;
  hasActiveJob: (batchId: string) => Promise<boolean>;
  recover: (batch: StalledCredentialBatch, token: string, staleBefore: Date) => Promise<CredentialBatchRecoveryOutcome>;
  now: () => Date;
};

export function credentialBatchReconciliationCutoff(
  now: Date,
  jobTimeoutSeconds = readWorkerJobTimeoutSeconds(),
): Date {
  return new Date(now.getTime() - jobTimeoutSeconds * 2 * 1_000);
}

export function defaultCredentialBatchReconciliationDependencies(
  queue: JobQueue,
): CredentialBatchReconciliationDependencies {
  return {
    findStalled: (staleBefore) => findStalledCredentialBatches(staleBefore, readReconcilePendingRunsBatchSize()),
    hasActiveJob: (batchId) => queue.hasActiveJob(CREDENTIAL_BATCH_ISSUE_JOB, batchId),
    recover: async (batch, token, staleBefore) => {
      try {
        return await prisma.$transaction(async (tx) => {
          const claimed = await claimBatchAttemptAndRelease(tx, {
            batchId: batch.id,
            tenantId: batch.tenantId,
            token,
            expectedVersion: batch.version,
            staleBefore,
          });
          if (!claimed.applied) return 'superseded';
          if (claimed.settled) return 'settled';
          if (claimed.settlement !== undefined) {
            return { outcome: 'unsettled', settlement: claimed.settlement };
          }
          await queue.enqueueWithin(
            prismaSqlExecutor(tx),
            CREDENTIAL_BATCH_ISSUE_JOB,
            { batchId: batch.id, tenantId: batch.tenantId },
            CREDENTIAL_BATCH_ISSUE_ENQUEUE_OPTIONS,
          );
          return 'requeued';
        });
      } catch (error) {
        if (error instanceof CredentialBatchAttemptFenceLostError) return 'superseded';
        throw error;
      }
    },
    now: () => new Date(Date.now()),
  };
}

export function credentialBatchReconciliationHandler(
  deps: CredentialBatchReconciliationDependencies,
): JobHandler<Record<string, never>> {
  return async () => {
    const now = deps.now();
    const staleBefore = credentialBatchReconciliationCutoff(now);
    const batches = await deps.findStalled(staleBefore);
    let requeued = 0;
    let settled = 0;
    let superseded = 0;
    let unsettled = 0;
    let active = 0;
    let failed = 0;
    for (const batch of batches) {
      if (await deps.hasActiveJob(batch.id)) {
        active += 1;
        logger.info({ batchId: batch.id, tenantId: batch.tenantId }, 'Stalled credential batch still has a queue job');
        continue;
      }
      try {
        const outcome = await deps.recover(batch, randomUUID(), staleBefore);
        if (outcome === 'requeued') requeued += 1;
        else if (outcome === 'settled') settled += 1;
        else if (outcome === 'superseded') superseded += 1;
        else {
          unsettled += 1;
          logger.warn(
            { batchId: batch.id, tenantId: batch.tenantId, settlement: outcome.settlement },
            'Credential batch settlement did not apply during recovery',
          );
        }
      } catch (error) {
        failed += 1;
        logger.error({ err: error, batchId: batch.id, tenantId: batch.tenantId }, 'Credential batch recovery failed');
      }
    }
    logger.info(
      { selected: batches.length, requeued, settled, superseded, unsettled, active, failed },
      'Credential batch reconciliation finished',
    );
  };
}

export function registerCredentialBatchReconciliation(
  queue: JobQueue,
  deps: CredentialBatchReconciliationDependencies = defaultCredentialBatchReconciliationDependencies(queue),
): void {
  queue.register(CREDENTIAL_BATCH_RECONCILE_JOB, credentialBatchReconciliationHandler(deps), { concurrency: 1 });
}
