import { verificationServiceUrl, verificationServiceToken } from '../../config';

export async function verifyCredential(credential: any) {
  try {
    const response = await fetch(verificationServiceUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${verificationServiceToken}`,
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
