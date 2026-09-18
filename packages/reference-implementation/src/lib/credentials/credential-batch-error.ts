import { errorMessage } from '@/lib/api/errors';
import { mapRouteError } from '@/lib/api/route-error-mapping';

export type CredentialBatchErrorOutcome = { code?: string; message: string };

export const BATCH_EXPIRED_MESSAGE = 'This credential batch has expired. Its credentials were not deleted.';
export const CREDENTIAL_BATCH_CANCEL_ACCEPTED_MESSAGE =
  'Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.';
export const CREDENTIAL_BATCH_NOT_CANCELLABLE_MESSAGE =
  'This credential batch cannot be cancelled because it has already settled.';

export function buildCredentialBatchExpiredBody(batchId?: string) {
  return {
    error: BATCH_EXPIRED_MESSAGE,
    code: 'BATCH_EXPIRED' as const,
    ...(batchId === undefined ? {} : { batchId }),
  };
}

/**
 * Projects stable fields for a worker item. An untyped worker fault retains its
 * caught error message so an operator can diagnose an exhausted item without
 * searching the logs.
 */
export function projectCredentialBatchError(error: unknown): CredentialBatchErrorOutcome {
  const mapped = mapRouteError(error);
  if (mapped === undefined) {
    return { code: 'UNEXPECTED', message: errorMessage(error) };
  }
  return mapped.code === undefined ? { message: mapped.message } : { code: mapped.code, message: mapped.message };
}
