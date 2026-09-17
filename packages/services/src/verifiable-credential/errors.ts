import { ServiceError } from '../errors.js';

/** Base error for all VC service operations. */
export class VcServiceError extends ServiceError {}

/**
 * Failed to sign a credential. A transport error or an abort after dispatch
 * can leave the external effect unknown.
 */
export class VcSignError extends VcServiceError {
  constructor(detail: string, httpStatus?: number, cause?: unknown) {
    super(`Failed to sign credential: ${detail}`, 'VC_SIGN_FAILED', httpStatus ?? 502, { httpStatus }, cause);
  }
}

/** Failed to verify a credential. */
export class VcVerifyError extends VcServiceError {
  constructor(detail: string, httpStatus?: number) {
    super(`Failed to verify credential: ${detail}`, 'VC_VERIFY_FAILED', httpStatus ?? 502, { httpStatus });
  }
}

/** Failed to decode a credential. */
export class VcDecodeError extends VcServiceError {
  constructor(detail: string) {
    super(`Failed to decode credential: ${detail}`, 'VC_DECODE_FAILED', 422);
  }
}

/**
 * Failed to issue credential status. A transport error or an abort after
 * dispatch can leave the external effect unknown.
 */
export class VcCredentialStatusError extends VcServiceError {
  constructor(detail: string, httpStatus?: number, cause?: unknown) {
    super(`Failed to issue credential status: ${detail}`, 'VC_STATUS_FAILED', httpStatus ?? 502, { httpStatus }, cause);
  }
}

/**
 * Failed to read a status-list entry. `httpStatus` echoes the response status
 * and is not a suggested consumer status.
 */
export class VcStatusReadError extends VcServiceError {
  protected static readonly errorCode: string = 'VC_STATUS_READ_FAILED';

  constructor(detail: string, httpStatus?: number, cause?: unknown) {
    super(
      `Failed to read credential status: ${detail}`,
      (new.target as typeof VcStatusReadError).errorCode,
      httpStatus ?? 502,
      { httpStatus },
      cause,
    );
  }
}

/**
 * Failed to set a status-list entry. `httpStatus` echoes the response status
 * and is not a suggested consumer status. A 4xx is treated as a definitive
 * refusal that applied nothing.
 */
export class VcStatusSetError extends VcServiceError {
  /**
   * | value | meaning |
   * | false | the service definitively refused (4xx), or nothing was sent (pre-flight abort) |
   * | true | in-flight abort, timeout, connection loss, 5xx, unreadable 2xx body, or mismatching 2xx body |
   */
  /** True means the requested value may have been applied before the failure. */
  public readonly mayHaveApplied: boolean;

  constructor(detail: string, mayHaveApplied: boolean, httpStatus?: number, cause?: unknown) {
    super(
      `Failed to set credential status: ${detail}`,
      'VC_STATUS_SET_FAILED',
      httpStatus ?? 502,
      {
        httpStatus,
        mayHaveApplied,
      },
      cause,
    );
    this.mayHaveApplied = mayHaveApplied;
  }
}

/**
 * The service returned a body that does not satisfy its status contract. A
 * successful HTTP response with an invalid body is exposed as a fixed 502
 * because the response could not be trusted as a status result.
 */
export class VcStatusResponseInvalidError extends VcServiceError {
  constructor(detail: string, cause?: unknown) {
    super(`Invalid credential status response: ${detail}`, 'VC_STATUS_RESPONSE_INVALID', 502, undefined, cause);
  }
}

/**
 * The service answered 404 while reading the status list addressed by an
 * entry. There is no set-side counterpart: a 404 answering a set is a
 * VcStatusSetError with `mayHaveApplied` false. `httpStatus` echoes the
 * response status and is not a suggested consumer status.
 */
export class VcStatusListNotFoundError extends VcStatusReadError {
  constructor(detail: string, httpStatus = 404, cause?: unknown) {
    super(`Status list not found: ${detail}`, httpStatus, cause);
  }

  protected static override readonly errorCode = 'VC_STATUS_LIST_NOT_FOUND';
}

/**
 * The requested status entry cannot be represented or supported. `reason` is
 * the string union `purpose | index | statusSize | input`
 * and identifies which unsupported-input category applied. reason `purpose`
 * is also raised at `sign()` where no entry exists yet.
 */
export class VcStatusEntryUnsupportedError extends VcServiceError {
  /** Identifies which unsupported-input category applied. */
  public readonly reason: 'purpose' | 'index' | 'statusSize' | 'input';

  constructor(detail: string, reason: 'purpose' | 'index' | 'statusSize' | 'input', cause?: unknown) {
    super(`Unsupported credential status entry: ${detail}`, 'VC_STATUS_ENTRY_UNSUPPORTED', 422, { reason }, cause);
    this.reason = reason;
  }
}
