import { NextResponse } from 'next/server';
import { apiLogger } from '@/lib/api/logger';
import { createReadiness } from '@/lib/health/readiness';
import { prisma } from '@/lib/prisma/prisma';

const readiness = createReadiness({
  // Awaited, because a Prisma query does not run until something awaits it.
  check: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  logger: apiLogger.child({ route: '/api/health/ready', check: 'database' }),
});

// Intentionally unauthenticated (outside the /api/v1/* middleware matcher) so
// load balancers and orchestrators can probe without credentials. Readiness
// asks one question: does the Prisma client the API routes use answer
// `SELECT 1` within 2 seconds.
export async function GET() {
  const { status } = await readiness.evaluate();
  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), checks: { database: { status } } },
    { status: status === 'pass' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
