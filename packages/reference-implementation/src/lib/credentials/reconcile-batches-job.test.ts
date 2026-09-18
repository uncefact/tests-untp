import type { StalledCredentialBatch } from '@/lib/prisma/repositories/credential-batch.repository';
import {
  credentialBatchReconciliationCutoff,
  credentialBatchReconciliationHandler,
  type CredentialBatchReconciliationDependencies,
} from './reconcile-batches-job';

const batch = {
  id: 'batch-1',
  tenantId: 'tenant-1',
  state: 'RUNNING',
  version: 2,
  attemptToken: 'old-token',
  lastProgressAt: new Date(0),
} as StalledCredentialBatch;

describe('credential batch reconciliation', () => {
  it('uses twice the job budget as its stalled cutoff', () => {
    // Regression: a still-legitimate attempt must not be taken over before two full job budgets.
    expect(credentialBatchReconciliationCutoff(new Date(60_000), 20)).toEqual(new Date(20_000));
  });

  it('re-enqueues vanished work but leaves an active job alone', async () => {
    // Regression: reconciliation must recover only batches without active or scheduled queue work.
    const deps: CredentialBatchReconciliationDependencies = {
      findStalled: jest.fn(async () => [batch, { ...batch, id: 'batch-2' }]),
      hasActiveJob: jest.fn(async (batchId) => batchId === 'batch-2'),
      claimAndEnqueue: jest.fn(async () => true),
      now: () => new Date(60_000),
    };

    await credentialBatchReconciliationHandler(deps)({} as never, {
      jobId: 'job',
      attempt: 1,
      isFinalAttempt: false,
      expireSeconds: 300,
      signal: new AbortController().signal,
    });

    expect(deps.claimAndEnqueue).toHaveBeenCalledTimes(1);
    expect(deps.claimAndEnqueue).toHaveBeenCalledWith(batch, expect.any(String), new Date(-540_000));
    expect(deps.hasActiveJob).toHaveBeenCalledWith('batch-2');
  });
});
