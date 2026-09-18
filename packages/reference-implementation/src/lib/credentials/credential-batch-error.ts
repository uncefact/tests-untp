import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
  ServiceInstanceNotFoundError,
  UnprocessableError,
} from '@/lib/api/errors';
import { mapRouteError } from '@/lib/api/route-error-mapping';
import { ValidationError } from '@/lib/api/validation';

export type CredentialBatchErrorOutcome = { code?: string; message: string };

export const BATCH_EXPIRED_MESSAGE = 'This credential batch has expired. Its credentials were not deleted.';
export const CREDENTIAL_BATCH_BODY_NOT_ALLOWED_MESSAGE = 'Send this request without a body.';
export const CREDENTIAL_BATCH_CANCEL_ACCEPTED_MESSAGE =
  'Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.';
export const CREDENTIAL_BATCH_NOT_CANCELLABLE_MESSAGE =
  'This credential batch cannot be cancelled because it has already settled.';

function isTenantSafeRouteError(error: unknown): boolean {
  return (
    error instanceof RequestBodyUnreadableError ||
    error instanceof ValidationError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof PayloadTooLargeError ||
    error instanceof UnprocessableError ||
    error instanceof ServiceInstanceNotFoundError
  );
}

export function buildCredentialBatchExpiredBody(batchId?: string) {
  return {
    error: BATCH_EXPIRED_MESSAGE,
    code: 'BATCH_EXPIRED' as const,
    ...(batchId === undefined ? {} : { batchId }),
  };
}

export function credentialBatchExpiredResponse(projection: object) {
  return {
    body: { ...projection, ...buildCredentialBatchExpiredBody() },
    init: { status: 410 as const, headers: { 'Cache-Control': 'no-store' } },
  };
}

/**
 * Projects stable fields for a worker item. An untyped worker fault is kept
 * tenant-safe while its raw error remains in the worker log.
 */
export function projectCredentialBatchError(error: unknown, itemCorrelationId: string): CredentialBatchErrorOutcome {
  const mapped = mapRouteError(error);
  if (mapped === undefined || !isTenantSafeRouteError(error)) {
    return {
      code: 'UNEXPECTED',
      message: `The item could not be issued because the issuing service faulted; ask your operator to search the logs for correlation id ${itemCorrelationId}.`,
    };
  }
  return mapped.code === undefined ? { message: mapped.message } : { code: mapped.code, message: mapped.message };
}
