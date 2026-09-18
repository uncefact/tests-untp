import { ServiceError, VcStatusEntryUnsupportedError, VcStatusResponseInvalidError } from '@uncefact/untp-ri-services';
import { UnprocessableError } from '@/lib/api/errors';
import {
  STATUS_PENDING_READ_NOTICE,
  statusEntryUnsupportedMessage,
  statusInvalidObservationMessage,
} from './credential-status-messages';

/** Sanitised status-operation failure. The cause stays in the operator log. */
export class CredentialStatusError extends ServiceError {
  constructor(
    code: string,
    message: string,
    statusCode = 503,
    cause?: unknown,
    readonly observed?: { value: boolean; observedAt: string },
    readonly clearFailure?: unknown,
  ) {
    super(message, code, statusCode, undefined, cause);
  }
}

const CLEAR_FAILURE_NOTICE =
  'The reservation could not be cleared. Read the stored status and reconcile if it remains pending.';

/** Adds the outcome of an owned reservation clear without changing the primary failure. */
export function statusFailureMessage(message: string, clearFailure: unknown, clearAttempted: boolean): string {
  if (!clearAttempted) return message;
  return `${message} ${clearFailure === undefined ? 'The reservation was cleared.' : CLEAR_FAILURE_NOTICE}`;
}

function withClearFailure<T extends Error>(error: T, clearFailure: unknown, clearAttempted: boolean): T {
  if (clearAttempted) Object.defineProperty(error, 'clearFailure', { value: clearFailure, enumerable: true });
  return error;
}

/** Stored descriptors are server-owned, so malformed input is a record fault. */
export function statusReadFailure(
  error: unknown,
  pendingKept = false,
  clearFailure?: unknown,
  clearAttempted = false,
  unavailableMessage?: string,
): Error {
  if (error instanceof CredentialStatusError) {
    if (!clearAttempted && !(pendingKept && error.code === 'VC_STATUS_RESPONSE_INVALID')) return error;
    const message =
      pendingKept && error.code === 'VC_STATUS_RESPONSE_INVALID'
        ? `${error.message} ${STATUS_PENDING_READ_NOTICE}`
        : error.message;
    return new CredentialStatusError(
      error.code,
      statusFailureMessage(message, clearFailure, clearAttempted),
      error.statusCode,
      error.cause,
      error.observed,
      clearAttempted ? clearFailure : error.clearFailure,
    );
  }
  if (error instanceof UnprocessableError) {
    const translated = new UnprocessableError(
      statusFailureMessage(
        pendingKept ? `${error.message} ${STATUS_PENDING_READ_NOTICE}` : error.message,
        clearFailure,
        clearAttempted,
      ),
      error.code,
    );
    return withClearFailure(translated, clearFailure, clearAttempted);
  }
  if (error instanceof VcStatusEntryUnsupportedError) {
    if (error.reason === 'input') {
      return new CredentialStatusError(
        'RECORD_UNREADABLE',
        statusFailureMessage(
          'The stored status entry cannot be read. Contact the operator.',
          clearFailure,
          clearAttempted,
        ),
        500,
        error,
        undefined,
        clearAttempted ? clearFailure : undefined,
      );
    }
    return withClearFailure(
      new UnprocessableError(
        statusFailureMessage(statusEntryUnsupportedMessage(pendingKept), clearFailure, clearAttempted),
        'STATUS_ENTRY_UNSUPPORTED',
      ),
      clearFailure,
      clearAttempted,
    );
  }
  if (error instanceof VcStatusResponseInvalidError) {
    return new CredentialStatusError(
      'VC_STATUS_RESPONSE_INVALID',
      statusFailureMessage(statusInvalidObservationMessage(pendingKept), clearFailure, clearAttempted),
      502,
      error,
      undefined,
      clearAttempted ? clearFailure : undefined,
    );
  }
  return new CredentialStatusError(
    'VC_SERVICE_UNAVAILABLE',
    statusFailureMessage(
      unavailableMessage ??
        (pendingKept
          ? 'The status could not be observed. The pending intent and previous confirmed value are unchanged. Retry reconciliation later.'
          : 'The status could not be observed. No set was dispatched and the previous confirmed value is unchanged.'),
      clearFailure,
      clearAttempted,
    ),
    503,
    error,
    undefined,
    clearAttempted ? clearFailure : undefined,
  );
}
