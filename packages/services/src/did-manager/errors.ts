import { ServiceError } from '../errors.js';

/** Base error for all DID manager operations. */
export class DidError extends ServiceError {}

/** DID adapter configuration is missing or invalid. */
export class DidConfigError extends DidError {
  constructor(field: string) {
    super(`DID adapter configuration error: ${field} is required.`, 'DID_CONFIG_INVALID', 500, { field });
  }
}

/** The requested DID method is not supported. */
export class DidMethodNotSupportedError extends DidError {
  constructor(method: string, operation?: string) {
    super(
      `DID method "${method}" is not supported${operation ? ` for ${operation}` : ''}.`,
      'DID_METHOD_NOT_SUPPORTED',
      400,
      { method, operation },
    );
  }
}

/** Invalid input provided to a DID operation. */
export class DidInputError extends DidError {
  constructor(detail: string) {
    super(`Invalid DID input: ${detail}`, 'DID_INPUT_INVALID', 400, { detail });
  }
}

/** Failed to create a DID via the upstream provider. */
export class DidCreateError extends DidError {
  constructor(detail: string, httpStatus?: number) {
    super(`Failed to create DID: ${detail}`, 'DID_CREATE_FAILED', 502, { httpStatus });
  }
}

/** Failed to fetch a DID document from the upstream provider. */
export class DidDocumentFetchError extends DidError {
  constructor(did: string, detail: string, httpStatus?: number) {
    super(`Failed to fetch DID document for "${did}": ${detail}`, 'DID_DOCUMENT_FETCH_FAILED', 502, {
      did,
      httpStatus,
    });
  }
}

/** Failed to parse a DID string. */
export class DidParseError extends DidError {
  constructor(did: string, detail: string) {
    super(`Failed to parse DID "${did}": ${detail}`, 'DID_PARSE_FAILED', 400, { did });
  }
}
