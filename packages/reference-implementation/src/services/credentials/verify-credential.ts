export type VerifyCredentialParams = {
  uri: string;
  digestMultibase?: string;
  hash?: string;
  decryptionKey?: string;
};

type VerifiedResult = {
  verified: true;
  credential: Record<string, unknown>;
  decodedCredential?: Record<string, unknown>;
  warnings?: string[];
};

type FailedVerificationResult = {
  verified: false;
  credential: Record<string, unknown>;
  decodedCredential?: Record<string, unknown>;
  warnings?: string[];
  error: {
    type: string;
    message: string;
  };
};

export type VerifyCredentialResult = VerifiedResult | FailedVerificationResult;

/**
 * Error codes the verification API can return with a 422/502, as documented
 * on `POST /api/v1/credentials/verify`. `VerifyCredentialError.code` stays a
 * plain string because the API can grow codes this client has not seen; this
 * union types the finite set the UI branches on so a typo fails to compile.
 */
export type VerifyErrorCode =
  | 'INVALID_RESPONSE'
  | 'DECRYPTION_REQUIRED'
  | 'ENVELOPE_INVALID'
  | 'DECRYPTION_FAILED'
  | 'DECRYPTED_NOT_JSON'
  | 'DIGEST_MISMATCH'
  | 'UNSUPPORTED_CREDENTIAL_TYPE'
  | 'UPSTREAM_ERROR'
  | 'VC_SERVICE_ERROR';

/**
 * A non-OK response from the verification API, carrying the HTTP status and
 * the API's error code so callers can branch on specific failures (the verify
 * page prompts for a key on `DECRYPTION_REQUIRED` and offers re-entry on
 * `DECRYPTION_FAILED`) instead of parsing the message text.
 */
export class VerifyCredentialError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'VerifyCredentialError';
    this.status = status;
    this.code = code;
  }
}

export async function verifyCredential(params: VerifyCredentialParams): Promise<VerifyCredentialResult> {
  if (!params.uri) {
    throw new Error('uri is required');
  }

  let response: Response;

  try {
    response = await fetch('/api/v1/credentials/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (e) {
    throw new Error('Unable to connect to the verification service', { cause: e });
  }

  if (response.ok) {
    try {
      return (await response.json()) as VerifyCredentialResult;
    } catch (e) {
      throw new Error('Received an invalid response from the verification service', { cause: e });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Verification request failed with status ${response.status}`, { cause: e });
  }

  const errorMessage = typeof body.error === 'string' ? body.error : 'Verification failed';
  const code = typeof body.code === 'string' ? body.code : undefined;

  throw new VerifyCredentialError(errorMessage, response.status, code);
}
