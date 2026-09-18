jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $transaction: jest.fn() },
}));

jest.mock('@/lib/prisma/repositories/credential-batch.repository', () => {
  const actual = jest.requireActual('@/lib/prisma/repositories/credential-batch.repository');
  return { ...actual, claimBatchAttemptAndRelease: jest.fn() };
});

import { runWithRequestContext } from '@uncefact/untp-ri-services/logging';
import { prisma } from '@/lib/prisma/prisma';
jest.mock('@/lib/api/logger');
import { appLogger } from '@/lib/api/logger';
import type { StalledCredentialBatch } from '@/lib/prisma/repositories/credential-batch.repository';
import {
  defaultCredentialBatchReconciliationDependencies,
  credentialBatchReconciliationCutoff,
  credentialBatchReconciliationHandler,
  type CredentialBatchReconciliationDependencies,
} from './reconcile-batches-job';

const prismaMock = prisma as unknown as { $transaction: jest.Mock };
const repositoryMock = jest.requireMock('@/lib/prisma/repositories/credential-batch.repository') as {
  claimBatchAttemptAndRelease: jest.Mock;
};

const batch = {
  id: 'batch-1',
  tenantId: 'tenant-1',
  correlationId: 'batch-correlation',
  state: 'RUNNING',
  version: 2,
  attemptToken: 'old-token',
  lastProgressAt: new Date(0),
} as StalledCredentialBatch;

describe('credential batch reconciliation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

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

  it('puts the stored batch correlation id in a takeover re-enqueue despite the sweep context', async () => {
    // Regression: reconciliation must not let its sweep correlation id overwrite the batch id used by the next worker.
    const previousValues = {
      limit: process.env.BATCH_JOB_RETRY_LIMIT,
      backoff: process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS,
      max: process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS,
    };
    process.env.BATCH_JOB_RETRY_LIMIT = '4';
    process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS = '10';
    process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS = '25';
    const enqueueWithin = jest.fn().mockResolvedValue(undefined);
    const queue = { enqueueWithin } as never;
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({} as never),
    );
    repositoryMock.claimBatchAttemptAndRelease.mockResolvedValue({ applied: true });

    try {
      const deps = defaultCredentialBatchReconciliationDependencies(queue);
      await runWithRequestContext('sweep-correlation', () => deps.recover(batch, 'takeover-token', new Date(60_000)));

      expect(enqueueWithin).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        { batchId: 'batch-1', tenantId: 'tenant-1', correlationId: 'batch-correlation' },
        { retry: { limit: 4, backoffSeconds: 10, backoffMaxSeconds: 25 } },
      );
    } finally {
      if (previousValues.limit === undefined) delete process.env.BATCH_JOB_RETRY_LIMIT;
      else process.env.BATCH_JOB_RETRY_LIMIT = previousValues.limit;
      if (previousValues.backoff === undefined) delete process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS;
      else process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS = previousValues.backoff;
      if (previousValues.max === undefined) delete process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS;
      else process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS = previousValues.max;
    }
  });
});

it('reports settled cancellations separately from requeued, superseded and failed recovery', async () => {
  const recover = jest
    .fn()
    .mockResolvedValueOnce('settled')
    .mockResolvedValueOnce('superseded')
    .mockRejectedValueOnce(new Error('database unavailable'));
  const deps: CredentialBatchReconciliationDependencies = {
    findStalled: jest.fn(async () => [batch, { ...batch, id: 'batch-2' }, { ...batch, id: 'batch-3' }]),
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
    { selected: 3, requeued: 0, settled: 1, superseded: 1, active: 0, failed: 1 },
    'Credential batch reconciliation finished',
  );
  expect(appLogger.error).toHaveBeenCalledWith(
    expect.objectContaining({ batchId: 'batch-3', err: expect.any(Error) }),
    'Credential batch recovery failed',
  );
});
