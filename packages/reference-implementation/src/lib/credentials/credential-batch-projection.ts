import type { CredentialBatchWithItems } from '@/lib/prisma/repositories/credential-batch.repository';

export type CredentialBatchStatus = ReturnType<typeof projectCredentialBatch>;

export const OPERATOR_CONFIRMED_FAILURE_CODE = 'OPERATOR_CONFIRMED_FAILED';
export const OPERATOR_CONFIRMED_FAILURE_MESSAGE = 'An operator confirmed this item was not issued.';

/** Projects durable batch state without exposing encrypted item requests. */
export function projectCredentialBatch(batch: CredentialBatchWithItems) {
  return {
    id: batch.id,
    state: batch.state,
    counts: {
      total: batch.itemCount,
      queued: batch.queuedCount,
      processing: batch.processingCount,
      issued: batch.issuedCount,
      failed: batch.failedCount,
      unknown: batch.unknownCount,
      cancelled: batch.cancelledCount,
    },
    cancelRequestedAt: batch.cancelRequestedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    settledAt: batch.settledAt?.toISOString() ?? null,
    items: batch.items.map((item) => {
      const error =
        item.errorClass === OPERATOR_CONFIRMED_FAILURE_CODE
          ? { code: item.errorClass, message: OPERATOR_CONFIRMED_FAILURE_MESSAGE }
          : item.errorClass === null || item.errorMessage === null
            ? undefined
            : { code: item.errorClass, message: item.errorMessage };

      return {
        index: item.index,
        state: item.state,
        ...(item.credentialId === null || (item.state !== 'ISSUED' && item.state !== 'OUTCOME_UNKNOWN')
          ? {}
          : { credentialId: item.credentialId }),
        ...(item.warning === null ? {} : { warning: item.warning }),
        ...(error === undefined ? {} : { error }),
      };
    }),
  };
}
