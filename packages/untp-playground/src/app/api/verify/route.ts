import { NextRequest, NextResponse } from 'next/server';
import { validityWindowError } from '@/lib/validityWindow';

const verificationServiceUrl = process.env.VERIFICATION_SERVICE_URL;
const verificationServiceToken = process.env.VERIFICATION_SERVICE_TOKEN;

export async function POST(request: NextRequest) {
  if (!verificationServiceUrl || !verificationServiceToken) {
    return NextResponse.json({ error: 'Verification service not configured' }, { status: 503 });
  }

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
      return NextResponse.json({ error: 'Verification failed' }, { status: response.status });
    }

    const data = await response.json();
    if (data?.verified === true) {
      const error = validityWindowError(credential);
      if (error) return NextResponse.json({ ...data, verified: false, error });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Verification proxy error:', error);
    return NextResponse.json({ error: 'Verification service unavailable' }, { status: 502 });
  }
}
