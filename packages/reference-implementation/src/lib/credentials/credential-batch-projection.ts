import type { CredentialBatchWithItems } from '@/lib/prisma/repositories/credential-batch.repository';

export type CredentialBatchStatus = ReturnType<typeof projectCredentialBatch>;

export const OPERATOR_CONFIRMED_FAILURE_CODE = 'OPERATOR_CONFIRMED_FAILED';
export const OPERATOR_CONFIRMED_FAILURE_MESSAGE = 'An operator confirmed this item was not issued.';

export type InterruptedBatchItemLogReference =
  | { itemCorrelationId: string }
  | { batchCorrelationId: string; index: number };

/**
 * Builds the tenant-facing message for an item left OUTCOME_UNKNOWN by an
 * interrupted attempt. The log reference names either the item's own
 * correlation id, or, when that id would not pass the shared validator, the
 * batch correlation id plus the item's index.
 */
export function interruptedBatchItemMessage(logReference: InterruptedBatchItemLogReference): string {
  const logDirection =
    'itemCorrelationId' in logReference
      ? `Search the logs for correlation id ${logReference.itemCorrelationId}.`
      : `Search the logs for batch correlation id ${logReference.batchCorrelationId}, item ${logReference.index}.`;
  return `A previous attempt was interrupted after it may have issued this item; check the library for a credential matching this request before re-submitting. ${logDirection}`;
}

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
        ...(item.reference === null || item.reference === undefined ? {} : { reference: item.reference }),
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
