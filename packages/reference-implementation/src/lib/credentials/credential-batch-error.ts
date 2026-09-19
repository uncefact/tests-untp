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
