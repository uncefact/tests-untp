import { CredentialBatchItemState, CredentialBatchState } from '../generated';
import {
  claimNextBatchItem,
  checkpointBatchContinuation,
  credentialBatchItemBackoffSeconds,
  markItemIssued,
  markItemQueued,
  resolveUnknownBatchItem,
} from './credential-batch.repository';

describe('markItemIssued', () => {
  it('carries the ownership token predicate into the issued-item write', async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      credentialBatchItem: { updateMany: itemUpdateMany },
      credentialBatch: { updateMany: batchUpdateMany },
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

describe('resolveUnknownBatchItem', () => {
  it('refuses a different issued credential id when the item already records one', async () => {
    // Regression: operator resolution must not replace a credential id learned after the ownership fence was lost.
    const batchUpdateMany = jest.fn();
    const itemUpdateMany = jest.fn();
    const credentialFindFirst = jest.fn();
    const tx = {
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

  it('orders claimable items by attempt count and then index, with never-attempted items first', async () => {
    const itemFindFirst = jest.fn().mockResolvedValue({ index: 2, request: 'encrypted-request' });
    const tx = {
      credentialBatchItem: { findFirst: itemFindFirst, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      credentialBatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
    const tx = { credentialBatchItem: { findFirst: itemFindFirst } } as never;

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
      credentialBatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as never;

    await expect(
      checkpointBatchContinuation(tx, {
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        token: 'attempt-token',
        queue: { enqueueWithin } as never,
        startAfter,
      }),
    ).resolves.toEqual({ applied: true });
    expect(enqueueWithin).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { batchId: 'batch-1', tenantId: 'tenant-1' },
      expect.objectContaining({ startAfter }),
    );
  });

  it('stores the next per-item retry time and the projected cause when re-queuing', async () => {
    const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      credentialBatchItem: {
        findFirst: jest.fn().mockResolvedValue({ attemptCount: 1 }),
        updateMany: itemUpdateMany,
      },
      credentialBatch: { updateMany: batchUpdateMany },
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
      credentialBatchItem: {
        findFirst: jest.fn().mockResolvedValue({ attemptCount: 3 }),
        updateMany: itemUpdateMany,
      },
      credentialBatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
});
