import { NextResponse } from 'next/server';

// Intentionally unauthenticated (outside /api/v1/* middleware matcher)
// so Docker healthchecks and load balancers can probe without credentials.
export function GET() {
  return NextResponse.json({ status: 'healthy', timestamp: new Date().toISOString() });
}
