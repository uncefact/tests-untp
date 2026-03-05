import { verificationServiceUrl as defaultUrl, verificationServiceToken as defaultToken } from '../../config';

export async function verifyCredential(
  credential: any,
  serviceUrl?: string,
  serviceToken?: string,
) {
  const url = serviceUrl || defaultUrl;
  const token = serviceToken || defaultToken;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential,
        fetchRemoteContexts: true,
        policies: {
          credentialStatus: false,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Verification failed');
    }

    return await response.json();
  } catch (error) {
    console.log('Verification error:', error);
    throw error;
  }
}
