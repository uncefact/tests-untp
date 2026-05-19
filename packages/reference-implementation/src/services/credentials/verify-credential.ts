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

  const errorMessage = body.error as string;
  const code = body.code as string | undefined;

  throw new Error(code ? `${errorMessage} (${code})` : errorMessage);
}
