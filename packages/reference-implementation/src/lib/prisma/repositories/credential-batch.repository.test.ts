jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $transaction: jest.fn(), credentialBatch: { findFirst: jest.fn() } },
}));

import { runWithRequestContext } from '@uncefact/untp-ri-services/logging';
import {
  credentialBatchItemBackoffSeconds,
  readCredentialBatchIssueEnqueueOptions,
} from '@/lib/config/credential-batch.config';
import { CredentialBatchItemState, CredentialBatchState } from '../generated';
import {
  claimBatchAttempt,
  claimNextBatchItem,
  classifyBatchCancellation,
  checkpointBatchContinuation,
  createCredentialBatch,
  decryptCredentialBatchItemRequest,
  getCredentialBatchItemForInspection,
  markItemIssued,
  markItemQueued,
  resolveUnknownBatchItem,
} from './credential-batch.repository';
import { prisma } from '../prisma';

const prismaMock = prisma as unknown as {
  $transaction: jest.Mock;
  credentialBatch: { findFirst: jest.Mock };
};

describe('createCredentialBatch', () => {
  const originalEncryptionKey = process.env.DATA_ENCRYPTION_KEY;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEncryptionKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('stores a reference beside the encrypted request without encrypting the reference', async () => {
    // Regression: the worker must receive the ordinary issuance body, while operators and status reads retain the issuer reference.
    process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
    const create = jest.fn().mockResolvedValue({ id: 'batch-1' });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const queue = { enqueueWithin: jest.fn().mockResolvedValue(undefined) };
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        credentialBatch: { create },
        credentialBatchItem: { createMany },
      }),
    );
    prismaMock.$transaction.mockImplementation(transaction);

    const item = {
      credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
      credentialType: 'DigitalProductPassport',
      version: '0.7.0',
      reference: 'PO-1',
    };
    const result = await runWithRequestContext('request-correlation', () =>
      createCredentialBatch({
        tenantId: 'tenant-1',
        idempotencyKey: 'key-1',
        bodyDigest: 'digest-1',
        items: [item],
        queue: queue as never,
      }),
    );

    expect(result).toEqual({ outcome: 'created', batchId: 'batch-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correlationId: 'request-correlation' }) }),
    );
    const storedItem = (createMany.mock.calls[0][0] as { data: Array<{ reference: string | null; request: string }> })
      .data[0];
    expect(storedItem.reference).toBe('PO-1');
    expect(JSON.parse(decryptCredentialBatchItemRequest(storedItem.request))).toEqual({
      credentialPayload: item.credentialPayload,
      credentialType: item.credentialType,
      version: item.version,
    });
    expect(JSON.parse(decryptCredentialBatchItemRequest(storedItem.request))).not.toHaveProperty('reference');
    expect(queue.enqueueWithin).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { batchId: 'batch-1', tenantId: 'tenant-1' },
      { retry: { limit: 4, backoffSeconds: 30, backoffMaxSeconds: 600 } },
    );
  });
});

describe('markItemIssued', () => {
  it('carries the ownership token predicate into the issued-item write', async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatchItem: { updateMany: itemUpdateMany },
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'attempt-token',
          cancelRequestedAt: null,
        }),
        updateMany: batchUpdateMany,
      },
    } as never;

    await markItemIssued(tx, {
      batchId: 'batch-1',
      tenantId: 'tenant-1',
      index: 0,
      token: 'attempt-token',
      credentialId: 'credential-1',
    });

    expect(itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: 'batch-1',
          tenantId: 'tenant-1',
          index: 0,
          state: CredentialBatchItemState.PROCESSING,
          attemptToken: 'attempt-token',
        }),
      }),
    );
    expect(batchUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: [CredentialBatchState.QUEUED, CredentialBatchState.RUNNING] },
          attemptToken: 'attempt-token',
        }),
      }),
    );
  });
});

describe('getCredentialBatchItemForInspection', () => {
  it('derives the item correlation id from the stored batch id and item index', async () => {
    // Regression: inspection must direct an operator to the exact item logs without persisting a duplicate item id.
    prismaMock.credentialBatch.findFirst.mockResolvedValue({
      id: 'batch-1',
      tenantId: 'tenant-1',
      correlationId: 'batch-correlation',
      state: CredentialBatchState.NEEDS_ATTENTION,
      bodyDigest: 'digest-1',
      createdAt: new Date('2026-09-17T00:00:00.000Z'),
      settledAt: new Date('2026-09-17T01:00:00.000Z'),
      resolvedAt: null,
      version: 3,
      items: [
        {
          index: 17,
          state: CredentialBatchItemState.OUTCOME_UNKNOWN,
          credentialId: null,
          errorClass: 'OUTCOME_UNKNOWN',
          errorMessage: 'unknown',
          resolutionReason: null,
          resolvedAt: null,
          updatedAt: new Date('2026-09-17T01:00:01.000Z'),
          reference: null,
          request: 'encrypted-request',
        },
      ],
    });

    await expect(getCredentialBatchItemForInspection('batch-1', 'tenant-1', 17)).resolves.toMatchObject({
      batchCorrelationId: 'batch-correlation',
      itemCorrelationId: 'batch-correlation_17',
    });
  });

  it('prints the batch and index fallback when the derived item correlation id is invalid', async () => {
    // Regression: inspection must not print an item id that no worker log can carry.
    prismaMock.credentialBatch.findFirst.mockResolvedValue({
      id: 'batch-1',
      tenantId: 'tenant-1',
      correlationId: 'b'.repeat(128),
      state: CredentialBatchState.NEEDS_ATTENTION,
      bodyDigest: 'digest-1',
      createdAt: new Date('2026-09-17T00:00:00.000Z'),
      settledAt: new Date('2026-09-17T01:00:00.000Z'),
      resolvedAt: null,
      version: 3,
      items: [{ index: 17 }],
    });

    await expect(getCredentialBatchItemForInspection('batch-1', 'tenant-1', 17)).resolves.toMatchObject({
      batchCorrelationId: 'b'.repeat(128),
      itemCorrelationId: '(not derivable; search by batchCorrelationId and index)',
    });
  });
});

describe('resolveUnknownBatchItem', () => {
  it('refuses a different issued credential id when the item already records one', async () => {
    // Regression: operator resolution must not replace a credential id learned after the ownership fence was lost.
    const batchUpdateMany = jest.fn();
    const itemUpdateMany = jest.fn();
    const credentialFindFirst = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.NEEDS_ATTENTION,
          itemCount: 1,
          queuedCount: 0,
          processingCount: 0,
          issuedCount: 0,
          failedCount: 0,
          unknownCount: 1,
          version: 7,
          createdAt: new Date('2026-09-17T00:00:00.000Z'),
          settledAt: new Date('2026-09-17T01:00:00.000Z'),
          resolvedAt: null,
          expiresAt: null,
        }),
        updateMany: batchUpdateMany,
      },
      credentialBatchItem: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchItemState.OUTCOME_UNKNOWN,
          credentialId: 'recorded-credential',
          errorClass: 'OUTCOME_UNKNOWN',
          errorMessage: 'check the library',
          updatedAt: new Date('2026-09-17T01:00:01.000Z'),
        }),
        updateMany: itemUpdateMany,
      },
      credential: { findFirst: credentialFindFirst },
    } as never;

    await expect(
      resolveUnknownBatchItem(tx, {
        tenantId: 'tenant-1',
        batchId: 'batch-1',
        index: 0,
        expectedVersion: 7,
        resolution: { state: 'ISSUED', credentialId: 'different-credential' },
        reason: 'operator checked the library',
      }),
    ).resolves.toMatchObject({ outcome: 'credential-recorded' });
    expect(credentialFindFirst).not.toHaveBeenCalled();
    expect(batchUpdateMany).not.toHaveBeenCalled();
    expect(itemUpdateMany).not.toHaveBeenCalled();
  });
});

describe('credential batch item retry scheduling', () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 120],
    [8, 600],
  ])('uses the capped doubling ladder for fault %s', (attemptCount, seconds) => {
    expect(credentialBatchItemBackoffSeconds(attemptCount)).toBe(seconds);
  });

  it('uses the configured base and cap for the item ladder', () => {
    // Regression: changing the shared retry policy must change item delays without introducing a separate ladder setting.
    const options = readCredentialBatchIssueEnqueueOptions({
      BATCH_JOB_RETRY_BACKOFF_SECONDS: '10',
      BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS: '25',
    });
    expect(credentialBatchItemBackoffSeconds(1, options)).toBe(10);
    expect(credentialBatchItemBackoffSeconds(2, options)).toBe(20);
    expect(credentialBatchItemBackoffSeconds(3, options)).toBe(25);
  });

  it('orders claimable items by attempt count and then index, with never-attempted items first', async () => {
    const itemFindFirst = jest.fn().mockResolvedValue({ index: 2, request: 'encrypted-request' });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatchItem: { findFirst: itemFindFirst, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'attempt-token',
          cancelRequestedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as never;

    await expect(
      claimNextBatchItem(tx, { batchId: 'batch-1', tenantId: 'tenant-1', token: 'attempt-token' }),
    ).resolves.toEqual({ outcome: 'claimed', item: { index: 2, request: 'encrypted-request' } });
    expect(itemFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }],
        }),
        orderBy: [{ attemptCount: 'asc' }, { index: 'asc' }],
      }),
    );
  });

  it('skips deferred items and returns the earliest retry time when none is due', async () => {
    const nextAttemptAt = new Date(Date.now() + 60_000);
    const itemFindFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ nextAttemptAt });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'attempt-token',
          cancelRequestedAt: null,
        }),
      },
      credentialBatchItem: { findFirst: itemFindFirst },
    } as never;

    await expect(
      claimNextBatchItem(tx, { batchId: 'batch-1', tenantId: 'tenant-1', token: 'attempt-token' }),
    ).resolves.toEqual({ outcome: 'empty', nextAttemptAt });
    expect(itemFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ nextAttemptAt: { gt: expect.any(Date) } }),
        orderBy: { nextAttemptAt: 'asc' },
      }),
    );
  });

  it('passes the earliest deferred retry time to the queue and releases the fence', async () => {
    const startAfter = new Date(Date.now() + 60_000);
    const enqueueWithin = jest.fn().mockResolvedValue(undefined);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'attempt-token',
          cancelRequestedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as never;

    await runWithRequestContext('caller-correlation', async () => {
      await expect(
        checkpointBatchContinuation(tx, {
          batchId: 'batch-1',
          tenantId: 'tenant-1',
          token: 'attempt-token',
          correlationId: 'batch-correlation',
          queue: { enqueueWithin } as never,
          startAfter,
        }),
      ).resolves.toEqual({ applied: true });
    });
    expect(enqueueWithin).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { batchId: 'batch-1', tenantId: 'tenant-1', correlationId: 'batch-correlation' },
      { retry: { limit: 4, backoffSeconds: 30, backoffMaxSeconds: 600 }, startAfter },
    );
  });

  it('writes the batch-derived correlation id into every item made outcome unknown by takeover', async () => {
    // Regression: takeover must preserve an operator-searchable item id instead of restoring the old generic message.
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'old-token',
          lastProgressAt: new Date(0),
          correlationId: 'batch-correlation',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      credentialBatchItem: {
        findMany: jest.fn().mockResolvedValue([{ index: 17 }]),
        updateMany: itemUpdateMany,
      },
    } as never;

    await expect(
      claimBatchAttempt(tx, {
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        token: 'new-token',
        expectedVersion: 2,
        staleBefore: new Date(60_000),
      }),
    ).resolves.toEqual({ applied: true });

    expect(itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage:
            'A previous attempt was interrupted after it may have issued this item; check the library for a credential matching this request before re-submitting. Search the logs for correlation id batch-correlation_17.',
        }),
      }),
    );
  });

  it('names the batch correlation id and index when takeover cannot derive an item id', async () => {
    // Regression: takeover must only name a correlation id that the worker can actually log.
    const batchCorrelationId = 'b'.repeat(128);
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'old-token',
          lastProgressAt: new Date(0),
          correlationId: batchCorrelationId,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      credentialBatchItem: {
        findMany: jest.fn().mockResolvedValue([{ index: 17 }]),
        updateMany: itemUpdateMany,
      },
    } as never;

    await expect(
      claimBatchAttempt(tx, {
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        token: 'new-token',
        expectedVersion: 2,
        staleBefore: new Date(60_000),
      }),
    ).resolves.toEqual({ applied: true });

    expect(itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: `A previous attempt was interrupted after it may have issued this item; check the library for a credential matching this request before re-submitting. Search the logs for batch correlation id ${batchCorrelationId}, item 17.`,
        }),
      }),
    );
  });

  it('stores the next per-item retry time and the projected cause when re-queuing', async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatchItem: {
        findFirst: jest.fn().mockResolvedValue({ attemptCount: 1 }),
        updateMany: itemUpdateMany,
      },
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'attempt-token',
          cancelRequestedAt: null,
        }),
        updateMany: batchUpdateMany,
      },
    } as never;
    const before = Date.now();

    await expect(
      markItemQueued(tx, {
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        index: 0,
        token: 'attempt-token',
        errorMessage: 'decrypt failed permanently',
      }),
    ).resolves.toEqual({ outcome: 'applied' });
    const update = itemUpdateMany.mock.calls[0][0] as { data: { nextAttemptAt: Date; attemptCount: number } };
    expect(update.data.attemptCount).toBe(2);
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(update.data.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('stores the projected cause when the fourth fault exhausts the item', async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      credentialBatchItem: {
        findFirst: jest.fn().mockResolvedValue({ attemptCount: 3 }),
        updateMany: itemUpdateMany,
      },
      credentialBatch: {
        findFirst: jest.fn().mockResolvedValue({
          state: CredentialBatchState.RUNNING,
          attemptToken: 'attempt-token',
          cancelRequestedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as never;

    await expect(
      markItemQueued(tx, {
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        index: 0,
        token: 'attempt-token',
        errorMessage: 'decrypt failed permanently',
      }),
    ).resolves.toEqual({ outcome: 'attempts-exhausted' });
    expect(itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: CredentialBatchItemState.FAILED,
          errorClass: 'ITEM_ATTEMPTS_EXHAUSTED',
          errorMessage: 'decrypt failed permanently',
          attemptCount: 4,
          nextAttemptAt: null,
        }),
      }),
    );
  });

  it('passes the configured retry policy to creation and continuation queue sends', async () => {
    // Regression: queue sends must use operator settings rather than the former fixed retry literal.
    const previousValues = {
      encryptionKey: process.env.DATA_ENCRYPTION_KEY,
      limit: process.env.BATCH_JOB_RETRY_LIMIT,
      backoff: process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS,
      max: process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS,
    };
    process.env.BATCH_JOB_RETRY_LIMIT = '4';
    process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS = '10';
    process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS = '25';
    process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

    try {
      jest.resetModules();
      let repository!: typeof import('./credential-batch.repository');
      let prismaForIsolatedModule!: typeof import('../prisma').prisma;
      jest.isolateModules(() => {
        repository = jest.requireActual('./credential-batch.repository');
        prismaForIsolatedModule = jest.requireMock('../prisma').prisma;
      });
      const create = jest.fn().mockResolvedValue({ id: 'batch-configured' });
      const createMany = jest.fn().mockResolvedValue({ count: 1 });
      const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          credentialBatch: { create, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          credentialBatchItem: { createMany },
        }),
      );
      (prismaForIsolatedModule as unknown as { $transaction: jest.Mock }).$transaction.mockImplementation(transaction);
      const creationQueue = { enqueueWithin: jest.fn().mockResolvedValue(undefined) };

      await repository.createCredentialBatch({
        tenantId: 'tenant-1',
        idempotencyKey: 'configured-key',
        bodyDigest: 'configured-digest',
        items: [{ credentialType: 'DigitalProductPassport', version: '0.7.0', credentialPayload: {} }],
        queue: creationQueue as never,
      });
      expect(creationQueue.enqueueWithin).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { retry: { limit: 4, backoffSeconds: 10, backoffMaxSeconds: 25 } },
      );

      const continuationQueue = { enqueueWithin: jest.fn().mockResolvedValue(undefined) };
      await repository.checkpointBatchContinuation(
        { credentialBatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as never,
        {
          batchId: 'batch-configured',
          tenantId: 'tenant-1',
          token: 'attempt-token',
          correlationId: 'batch-correlation',
          queue: continuationQueue as never,
        },
      );
      expect(continuationQueue.enqueueWithin).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { retry: { limit: 4, backoffSeconds: 10, backoffMaxSeconds: 25 } },
      );
    } finally {
      if (previousValues.encryptionKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
      else process.env.DATA_ENCRYPTION_KEY = previousValues.encryptionKey;
      if (previousValues.limit === undefined) delete process.env.BATCH_JOB_RETRY_LIMIT;
      else process.env.BATCH_JOB_RETRY_LIMIT = previousValues.limit;
      if (previousValues.backoff === undefined) delete process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS;
      else process.env.BATCH_JOB_RETRY_BACKOFF_SECONDS = previousValues.backoff;
      if (previousValues.max === undefined) delete process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS;
      else process.env.BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS = previousValues.max;
    }
  });
});

describe('classifyBatchCancellation', () => {
  it.each([
    [CredentialBatchState.QUEUED, null, 'cancellable'],
    [CredentialBatchState.RUNNING, null, 'cancellable'],
    [CredentialBatchState.QUEUED, new Date(0), 'already-requested'],
    [CredentialBatchState.RUNNING, new Date(0), 'already-requested'],
    [CredentialBatchState.COMPLETED, null, 'not-cancellable'],
    [CredentialBatchState.NEEDS_ATTENTION, new Date(0), 'not-cancellable'],
    [CredentialBatchState.CANCELLED, new Date(0), 'not-cancellable'],
    [CredentialBatchState.EXPIRED, new Date(0), 'expired'],
  ])('classifies %s with cancellation timestamp %s as %s', (state, cancelRequestedAt, expected) => {
    expect(classifyBatchCancellation({ state, cancelRequestedAt })).toBe(expected);
  });
});
