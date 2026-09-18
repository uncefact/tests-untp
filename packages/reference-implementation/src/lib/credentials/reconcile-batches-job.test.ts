jest.mock('@/lib/api/logger');
import { appLogger } from '@/lib/api/logger';
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
      recover: jest.fn(async () => 'requeued' as const),
      now: () => new Date(60_000),
    };

    await credentialBatchReconciliationHandler(deps)({} as never, {
      jobId: 'job',
      attempt: 1,
      isFinalAttempt: false,
      expireSeconds: 300,
      signal: new AbortController().signal,
    });

    expect(deps.recover).toHaveBeenCalledTimes(1);
    expect(deps.recover).toHaveBeenCalledWith(batch, expect.any(String), new Date(-540_000));
    expect(deps.hasActiveJob).toHaveBeenCalledWith('batch-2');
  });
});

it('reports unsettled cancellations separately from requeued, superseded and failed recovery', async () => {
  // Regression: a non-applied settlement must be warned and counted separately from superseded recovery.
  const recover = jest
    .fn()
    .mockResolvedValueOnce('settled')
    .mockResolvedValueOnce('superseded')
    .mockResolvedValueOnce({ outcome: 'unsettled', settlement: 'not-ready' } as const)
    .mockRejectedValueOnce(new Error('database unavailable'));
  const deps: CredentialBatchReconciliationDependencies = {
    findStalled: jest.fn(async () => [
      batch,
      { ...batch, id: 'batch-2' },
      { ...batch, id: 'batch-3' },
      { ...batch, id: 'batch-4' },
    ]),
    hasActiveJob: jest.fn(async () => false),
    recover,
    now: () => new Date(60_000),
  };
  await credentialBatchReconciliationHandler(deps)({} as never, {
    jobId: 'job',
    attempt: 1,
    isFinalAttempt: false,
    expireSeconds: 300,
    signal: new AbortController().signal,
  });
  expect(appLogger.info).toHaveBeenCalledWith(
    { selected: 4, requeued: 0, settled: 1, superseded: 1, unsettled: 1, active: 0, failed: 1 },
    'Credential batch reconciliation finished',
  );
  expect(appLogger.warn).toHaveBeenCalledWith(
    { batchId: 'batch-3', tenantId: 'tenant-1', settlement: 'not-ready' },
    'Credential batch settlement did not apply during recovery',
  );
  expect(appLogger.error).toHaveBeenCalledWith(
    expect.objectContaining({ batchId: 'batch-4', tenantId: 'tenant-1', err: expect.any(Error) }),
    'Credential batch recovery failed',
  );
});
