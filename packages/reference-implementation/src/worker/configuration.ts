import {
  readReconcilePendingRunsBatchSize,
  readReconcilePendingRunsCron,
} from '../lib/config/reconcile-pending-runs.config';
import { readWorkerJobTimeoutSeconds } from '../lib/config/worker-job-timeout.config';
import { WorkerBootError } from './errors';

export interface WorkerConfiguration {
  reconciliationCron: string;
  jobTimeoutSeconds: number;
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
    const jobTimeoutSeconds = readWorkerJobTimeoutSeconds();
    return { reconciliationCron, jobTimeoutSeconds };
  } catch (error) {
    throw new WorkerBootError('worker.configuration-invalid', error instanceof Error ? error.message : String(error));
  }
}
