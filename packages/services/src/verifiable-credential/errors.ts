import { ServiceError } from '../errors.js';

/** Base error for all VC service operations. */
export class VcServiceError extends ServiceError {}

/** Failed to sign a credential. */
export class VcSignError extends VcServiceError {
  constructor(detail: string, httpStatus?: number) {
    super(`Failed to sign credential: ${detail}`, 'VC_SIGN_FAILED', httpStatus ?? 502, { httpStatus });
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

/** Failed to issue credential status. */
export class VcCredentialStatusError extends VcServiceError {
  constructor(detail: string, httpStatus?: number) {
    super(`Failed to issue credential status: ${detail}`, 'VC_STATUS_FAILED', httpStatus ?? 502, { httpStatus });
  }
}
