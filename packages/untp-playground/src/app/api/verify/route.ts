import { NextRequest, NextResponse } from 'next/server';

const verificationServiceUrl =
  process.env.VERIFICATION_SERVICE_URL ||
  'https://vckit.untp.showthething.com/agent/routeVerificationCredential';
const verificationServiceToken = process.env.VERIFICATION_SERVICE_TOKEN || 'test123';

export async function POST(request: NextRequest) {
  try {
    const { credential } = await request.json();

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
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Verification proxy error:', error);
    return NextResponse.json(
      { error: 'Verification service unavailable' },
      { status: 502 },
    );
  }
}
