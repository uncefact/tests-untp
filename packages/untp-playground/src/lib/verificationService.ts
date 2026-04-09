export async function verifyCredential(credential: any) {
  try {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const response = await fetch(`${basePath}/api/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential }),
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
