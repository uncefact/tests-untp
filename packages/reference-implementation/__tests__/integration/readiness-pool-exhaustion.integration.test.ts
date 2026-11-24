/**
 * `GET /api/health/ready` when the application's own Prisma client has no
 * free connection.
 *
 * One deviation from sibling suites: this suite changes `RI_DATABASE_URL`
 * before the application's Prisma singleton is first imported, because which
 * client the route uses is the thing under test. The URL is not built from
 * parts. It is the rig's guarded `RI_DATABASE_URL` with one query parameter,
 * `connection_limit`, set to 1.
 */
import { performance } from 'node:perf_hooks';
import { READINESS_CHECK_TIMEOUT_MS, READINESS_REUSE_MS } from '../../src/lib/health/readiness';
import { barrier } from './rig/locks';

interface ReadinessBody {
  status: 'pass' | 'fail';
  timestamp: string;
  checks: { database: { status: 'pass' | 'fail' } };
}

const originalUrl = process.env.RI_DATABASE_URL;
const REUSE_WAIT_MS = READINESS_REUSE_MS + 250;

let getReady: () => Promise<Response>;
let prisma: (typeof import('../../src/lib/prisma/prisma'))['prisma'] | undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  if (!originalUrl) throw new Error('RI_DATABASE_URL is not set; the integration rig sets it in global setup');
  const url = new URL(originalUrl);
  url.searchParams.set('connection_limit', '1');
  process.env.RI_DATABASE_URL = url.toString();
  ({ GET: getReady } = await import('../../src/app/api/health/ready/route'));
  ({ prisma } = await import('../../src/lib/prisma/prisma'));
});

afterAll(async () => {
  try {
    await prisma?.$disconnect();
  } finally {
    if (originalUrl === undefined) delete process.env.RI_DATABASE_URL;
    else process.env.RI_DATABASE_URL = originalUrl;
  }
});

describe('GET /api/health/ready with the application pool exhausted', () => {
  // A route that built its own Prisma client would still read 200 while the
  // application's only connection is held, so this case fails it: readiness
  // must report on the pool the API routes actually use.
  it('an orchestrator sees 503 when the pool the API routes use has no free connection', async () => {
    const client = prisma;
    if (client === undefined) throw new Error('the application Prisma client was not imported');

    const warm = await getReady();
    expect(warm.status).toBe(200);
    await sleep(REUSE_WAIT_MS);

    const held = barrier();
    const released = barrier();
    const hold = client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        held.release();
        await released.promise;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );

    let assertionsPassed = false;
    try {
      // A query inside the transaction has returned, so the only connection is checked out.
      await Promise.race([held.promise, hold]);

      const startedAt = performance.now();
      const response = await getReady();
      const elapsedMs = performance.now() - startedAt;
      const body = (await response.json()) as ReadinessBody;

      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.status).toBe('fail');
      expect(body.checks.database.status).toBe('fail');
      expect(elapsedMs).toBeGreaterThanOrEqual(READINESS_CHECK_TIMEOUT_MS - 100);
      assertionsPassed = true;
    } finally {
      released.release();
      // A failed hold is reported only when it would not replace an earlier failure.
      await hold.catch((error: unknown) => {
        if (assertionsPassed) throw error;
      });
    }

    await sleep(REUSE_WAIT_MS);
    const recovered = await getReady();
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as ReadinessBody).checks.database.status).toBe('pass');
  });
});
