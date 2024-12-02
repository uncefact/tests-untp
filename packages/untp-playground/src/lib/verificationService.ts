const API_URL = 'https://vckit.untp.showthething.com/agent/routeVerificationCredential';
const API_TOKEN = 'test123';

export async function verifyCredential(credential: any) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
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
