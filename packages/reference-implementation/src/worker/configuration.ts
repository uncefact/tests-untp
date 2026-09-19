import {
  readReconcilePendingRunsBatchSize,
  readReconcilePendingRunsCron,
} from '../lib/config/reconcile-pending-runs.config';
import {
  readBatchBudgetSettings,
  readBatchExpirySweepCron,
  readBatchRetentionDays,
  type CredentialBatchBudgetSettings,
} from '../lib/config/credential-batch.config';
import { readWorkerJobTimeoutSeconds } from '../lib/config/worker-job-timeout.config';
import { readBatchJobConcurrency } from '../lib/config/batch-job-concurrency.config';
import { WorkerBootError } from './errors';

export interface WorkerConfiguration {
  reconciliationCron: string;
  batchExpirySweepCron: string;
  jobTimeoutSeconds: number;
  batchJobConcurrency: number;
  batchBudgetSettings: CredentialBatchBudgetSettings;
}

/**
 * The worker preflight calls this once before the queue and returns its
 * values to bootstrap. Reader failures retain the stable boot code before
 * the queue can start.
 */
export function resolveWorkerConfiguration(): WorkerConfiguration {
  try {
    const reconciliationCron = readReconcilePendingRunsCron();
    readReconcilePendingRunsBatchSize();
    readBatchRetentionDays();
    const batchExpirySweepCron = readBatchExpirySweepCron();
    const jobTimeoutSeconds = readWorkerJobTimeoutSeconds();
    const batchBudgetSettings = readBatchBudgetSettings();
    const batchJobConcurrency = readBatchJobConcurrency();
    return { reconciliationCron, batchExpirySweepCron, jobTimeoutSeconds, batchJobConcurrency, batchBudgetSettings };
  } catch (error) {
    throw new WorkerBootError('worker.configuration-invalid', error instanceof Error ? error.message : String(error));
  }
}
