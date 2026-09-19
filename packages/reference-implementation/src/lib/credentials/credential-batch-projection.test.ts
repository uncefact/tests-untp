import { CredentialBatchItemState, CredentialBatchState } from '@/lib/prisma/generated';
import { interruptedBatchItemMessage, projectCredentialBatch } from './credential-batch-projection';

it('formats an interrupted item message with the item correlation id', () => {
  // Regression: takeover and worker fault paths must share one tenant-facing message format.
  expect(interruptedBatchItemMessage({ itemCorrelationId: 'batch-correlation_3' })).toBe(
    'A previous attempt was interrupted after it may have issued this item; check the library for a credential matching this request before re-submitting. Search the logs for correlation id batch-correlation_3.',
  );
});

it('formats an interrupted item message with the batch correlation id and index when the item id is unusable', () => {
  // Regression: the fallback form must produce the exact same wording, sourced from the single helper.
  expect(interruptedBatchItemMessage({ batchCorrelationId: 'batch-correlation', index: 17 })).toBe(
    'A previous attempt was interrupted after it may have issued this item; check the library for a credential matching this request before re-submitting. Search the logs for batch correlation id batch-correlation, item 17.',
  );
});

describe('projectCredentialBatch', () => {
  it('projects the stored pre-dispatch fault message unchanged', () => {
    // Regression: the durable tenant projection must preserve the stored fault code and message exactly.
    const message =
      'The item could not be issued because the issuing service faulted; ask your operator to search the logs for correlation id batch-correlation_0.';
    const result = projectCredentialBatch({
      id: 'batch-fault',
      tenantId: 'tenant-1',
      correlationId: 'batch-correlation',
      state: CredentialBatchState.COMPLETED,
      itemCount: 1,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 1,
      unknownCount: 0,
      cancelledCount: 0,
      idempotencyKey: 'key-fault',
      bodyDigest: 'digest-fault',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      settledAt: new Date(0),
      resolvedAt: null,
      expiresAt: new Date(1),
      cancelRequestedAt: null,
      attemptToken: null,
      attemptStartedAt: null,
      version: 1,
      lastProgressAt: new Date(0),
      items: [
        {
          id: 'item-fault',
          batchId: 'batch-fault',
          tenantId: 'tenant-1',
          index: 0,
          reference: null,
          state: CredentialBatchItemState.FAILED,
          request: 'encrypted request',
          credentialId: null,
          warning: null,
          errorClass: 'UNEXPECTED',
          errorMessage: message,
          resolvedAt: null,
          resolutionReason: null,
          attemptCount: 4,
          nextAttemptAt: null,
          attemptToken: null,
          updatedAt: new Date(0),
        },
      ],
    });

    expect(result.items[0].error).toEqual({ code: 'UNEXPECTED', message });
  });

  it('projects cancelled, issued and failed outcomes with their stored counts and retained credential id', () => {
    const result = projectCredentialBatch({
      id: 'batch-1',
      tenantId: 'tenant-1',
      correlationId: 'batch-correlation',
      state: CredentialBatchState.CANCELLED,
      itemCount: 3,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 1,
      unknownCount: 0,
      cancelledCount: 1,
      cancelRequestedAt: new Date('2026-09-17T01:02:30.000Z'),
      idempotencyKey: 'key-1',
      bodyDigest: 'digest-1',
      createdAt: new Date('2026-09-17T01:02:03.000Z'),
      updatedAt: new Date('2026-09-17T01:03:03.000Z'),
      settledAt: new Date('2026-09-17T01:03:03.000Z'),
      resolvedAt: null,
      expiresAt: new Date('2026-10-17T01:03:03.000Z'),
      attemptToken: null,
      attemptStartedAt: null,
      version: 2,
      lastProgressAt: new Date('2026-09-17T01:03:03.000Z'),
      items: [
        {
          id: 'item-2',
          batchId: 'batch-1',
          tenantId: 'tenant-1',
          index: 2,
          reference: null,
          state: CredentialBatchItemState.CANCELLED,
          request: 'encrypted cancelled request',
          credentialId: null,
          warning: null,
          errorClass: null,
          errorMessage: null,
          resolvedAt: null,
          resolutionReason: null,
          attemptCount: 0,
          nextAttemptAt: null,
          attemptToken: null,
          updatedAt: new Date('2026-09-17T01:03:00.000Z'),
        },
        {
          id: 'item-1',
          batchId: 'batch-1',
          tenantId: 'tenant-1',
          index: 1,
          reference: 'PO-1',
          state: CredentialBatchItemState.FAILED,
          request: 'encrypted request',
          credentialId: 'cred-1',
          warning: null,
          errorClass: 'SERVICE_INSTANCE_NOT_FOUND',
          errorMessage: 'Service instance not found: storage-missing',
          resolvedAt: null,
          resolutionReason: null,
          attemptCount: 0,
          nextAttemptAt: null,
          attemptToken: null,
          updatedAt: new Date('2026-09-17T01:03:00.000Z'),
        },
        {
          id: 'item-0',
          batchId: 'batch-1',
          tenantId: 'tenant-1',
          index: 0,
          reference: 'PO-0',
          state: CredentialBatchItemState.ISSUED,
          request: 'encrypted request',
          credentialId: 'cred-0',
          warning: { code: 'DETAILS_EXTRACTION_FAILED', message: 'warning' },
          errorClass: null,
          errorMessage: null,
          resolvedAt: null,
          resolutionReason: null,
          attemptCount: 0,
          nextAttemptAt: null,
          attemptToken: null,
          updatedAt: new Date('2026-09-17T01:03:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({
      id: 'batch-1',
      state: 'CANCELLED',
      counts: { total: 3, queued: 0, processing: 0, issued: 1, failed: 1, unknown: 0, cancelled: 1 },
      cancelRequestedAt: '2026-09-17T01:02:30.000Z',
      createdAt: '2026-09-17T01:02:03.000Z',
      settledAt: '2026-09-17T01:03:03.000Z',
      items: [
        { index: 2, state: 'CANCELLED' },
        {
          index: 1,
          reference: 'PO-1',
          state: 'FAILED',
          error: { code: 'SERVICE_INSTANCE_NOT_FOUND', message: 'Service instance not found: storage-missing' },
        },
        {
          index: 0,
          reference: 'PO-0',
          state: 'ISSUED',
          credentialId: 'cred-0',
          warning: { code: 'DETAILS_EXTRACTION_FAILED', message: 'warning' },
        },
      ],
    });
  });

  it('replaces operator failure evidence with the fixed tenant-facing message', () => {
    // Regression: operator evidence is an audit detail and must not be returned to the tenant.
    const result = projectCredentialBatch({
      id: 'batch-operator-failure',
      tenantId: 'tenant-1',
      correlationId: 'batch-operator-failure-correlation',
      state: CredentialBatchState.COMPLETED,
      itemCount: 1,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 1,
      unknownCount: 0,
      cancelledCount: 0,
      cancelRequestedAt: null,
      idempotencyKey: 'key-operator-failure',
      bodyDigest: 'digest-operator-failure',
      createdAt: new Date('2026-09-17T01:02:03.000Z'),
      updatedAt: new Date('2026-09-17T01:03:03.000Z'),
      settledAt: new Date('2026-09-17T01:03:03.000Z'),
      resolvedAt: new Date('2026-09-17T01:03:04.000Z'),
      expiresAt: new Date('2026-10-17T01:03:04.000Z'),
      attemptToken: null,
      attemptStartedAt: null,
      version: 2,
      lastProgressAt: new Date('2026-09-17T01:03:04.000Z'),
      items: [
        {
          id: 'item-operator-failure',
          batchId: 'batch-operator-failure',
          tenantId: 'tenant-1',
          index: 0,
          reference: null,
          state: CredentialBatchItemState.FAILED,
          request: 'encrypted request',
          credentialId: null,
          warning: null,
          errorClass: 'OPERATOR_CONFIRMED_FAILED',
          errorMessage: 'internal ticket reference and investigation notes',
          resolvedAt: null,
          resolutionReason: null,
          attemptCount: 0,
          nextAttemptAt: null,
          attemptToken: null,
          updatedAt: new Date('2026-09-17T01:03:04.000Z'),
        },
      ],
    });

    expect(result.cancelRequestedAt).toBeNull();
    expect(result.items).toEqual([
      {
        index: 0,
        state: 'FAILED',
        error: {
          code: 'OPERATOR_CONFIRMED_FAILED',
          message: 'An operator confirmed this item was not issued.',
        },
      },
    ]);
  });
});
