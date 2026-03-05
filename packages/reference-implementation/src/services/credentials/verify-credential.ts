export type VerifyCredentialParams = {
  uri: string;
  hash?: string;
  decryptionKey?: string;
};

export type VerifyCredentialResult = {
  verified: boolean;
  credential: Record<string, unknown>;
  decodedCredential?: Record<string, unknown>;
  warnings?: string[];
  error?: {
    type: string;
    message: string;
  };
};

export async function verifyCredential(params: VerifyCredentialParams): Promise<VerifyCredentialResult> {
  let response: Response;

  try {
    response = await fetch('/api/v1/credentials/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error('Unable to connect to the verification service');
  }

  if (response.ok) {
    return (await response.json()) as VerifyCredentialResult;
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Verification request failed with status ${response.status}`);
  }

  const errorMessage = body.error as string;
  const code = body.code as string | undefined;

  throw new Error(code ? `${errorMessage} (${code})` : errorMessage);
}
