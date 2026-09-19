import { randomUUID } from 'node:crypto';
import { appLogger } from '@/lib/api/logger';
import { runWithRequestContext } from '@uncefact/untp-ri-services/logging';
import { readReconcilePendingRunsBatchSize } from '@/lib/config/reconcile-pending-runs.config';
import { getCredentialBatchIssueEnqueueOptions } from '@/lib/config/credential-batch.config';
import { readWorkerJobTimeoutSeconds } from '@/lib/config/worker-job-timeout.config';
import { CREDENTIAL_BATCH_ISSUE_JOB, CREDENTIAL_BATCH_RECONCILE_JOB } from '@/lib/jobs/queue-names';
import type { JobHandler, JobQueue } from '@/lib/jobs/types';
import { prismaSqlExecutor } from '@/lib/jobs/prisma-sql-executor';
import {
  CredentialBatchAttemptFenceLostError,
  claimBatchAttemptAndRelease,
  findStalledCredentialBatches,
  type StalledCredentialBatch,
} from '@/lib/prisma/repositories/credential-batch.repository';
import { prisma } from '@/lib/prisma/prisma';

const logger = appLogger.child({ module: 'reconcile-credential-batches-job' });

export type CredentialBatchReconciliationDependencies = {
  findStalled: (staleBefore: Date) => Promise<StalledCredentialBatch[]>;
  hasActiveJob: (batchId: string) => Promise<boolean>;
  claimAndEnqueue: (batch: StalledCredentialBatch, token: string, staleBefore: Date) => Promise<boolean>;
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
    claimAndEnqueue: async (batch, token, staleBefore) => {
      try {
        return await prisma.$transaction(async (tx) => {
          const claimed = await claimBatchAttemptAndRelease(tx, {
            batchId: batch.id,
            tenantId: batch.tenantId,
            token,
            expectedVersion: batch.version,
            staleBefore,
          });
          if (!claimed.applied) return false;
          await queue.enqueueWithin(
            prismaSqlExecutor(tx),
            CREDENTIAL_BATCH_ISSUE_JOB,
            { batchId: batch.id, tenantId: batch.tenantId, correlationId: batch.correlationId },
            getCredentialBatchIssueEnqueueOptions(),
          );
          return true;
        });
      } catch (error) {
        if (error instanceof CredentialBatchAttemptFenceLostError) return false;
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
    let active = 0;
    let failed = 0;
    for (const batch of batches) {
      await runWithRequestContext(batch.correlationId, async () => {
        if (await deps.hasActiveJob(batch.id)) {
          active += 1;
          logger.info(
            {
              correlationId: batch.correlationId,
              batchCorrelationId: batch.correlationId,
              batchId: batch.id,
              tenantId: batch.tenantId,
            },
            'Stalled credential batch still has a queue job',
          );
          return;
        }
        try {
          if (await deps.claimAndEnqueue(batch, randomUUID(), staleBefore)) requeued += 1;
        } catch (error) {
          failed += 1;
          logger.error(
            {
              correlationId: batch.correlationId,
              batchCorrelationId: batch.correlationId,
              err: error,
              batchId: batch.id,
              tenantId: batch.tenantId,
            },
            'Credential batch re-enqueue failed',
          );
        }
      });
    }
    logger.info({ selected: batches.length, requeued, active, failed }, 'Credential batch reconciliation finished');
  };
}

export function registerCredentialBatchReconciliation(
  queue: JobQueue,
  deps: CredentialBatchReconciliationDependencies = defaultCredentialBatchReconciliationDependencies(queue),
): void {
  queue.register(CREDENTIAL_BATCH_RECONCILE_JOB, credentialBatchReconciliationHandler(deps), { concurrency: 1 });
}
