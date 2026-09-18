import {
  readReconcilePendingRunsBatchSize,
  readReconcilePendingRunsCron,
} from '../lib/config/reconcile-pending-runs.config';
import { readBatchExpirySweepCron } from '../lib/config/credential-batch.config';
import { readWorkerJobTimeoutSeconds } from '../lib/config/worker-job-timeout.config';
import { readBatchJobConcurrency } from '../lib/config/batch-job-concurrency.config';
import { WorkerBootError } from './errors';

export interface WorkerConfiguration {
  reconciliationCron: string;
  batchExpirySweepCron: string;
  jobTimeoutSeconds: number;
  batchJobConcurrency: number;
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
    const batchExpirySweepCron = readBatchExpirySweepCron();
    const jobTimeoutSeconds = readWorkerJobTimeoutSeconds();
    const batchJobConcurrency = readBatchJobConcurrency();
    return { reconciliationCron, batchExpirySweepCron, jobTimeoutSeconds, batchJobConcurrency };
  } catch (error) {
    throw new WorkerBootError('worker.configuration-invalid', error instanceof Error ? error.message : String(error));
  }
}
