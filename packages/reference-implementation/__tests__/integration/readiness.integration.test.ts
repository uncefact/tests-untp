/**
 * `GET /api/health/ready` against the real route handler and the
 * application's own Prisma client, with a TCP relay between the client and
 * the rig's database so a suite can cut or stall the path.
 *
 * One deviation from sibling suites: this suite changes `RI_DATABASE_URL`
 * before the application's Prisma singleton is first imported, because which
 * client the route uses is the thing under test. The URL is not built from
 * parts. It is the rig's guarded `RI_DATABASE_URL` with the host and port
 * replaced by the relay's and any `host` query parameter removed.
 */
import { performance } from 'node:perf_hooks';
import { GET as getLive } from '../../src/app/api/health/route';
import {
  READINESS_CHECK_TIMEOUT_MS,
  READINESS_REPLACEMENT_AFTER_MS,
  READINESS_REUSE_MS,
} from '../../src/lib/health/readiness';
import { startTcpRelay, type TcpRelay } from './rig/tcp-relay';

interface ReadinessBody {
  status: 'pass' | 'fail';
  timestamp: string;
  checks: { database: { status: 'pass' | 'fail' } };
}

interface Probe {
  status: number;
  body: ReadinessBody;
  cacheControl: string | null;
  elapsedMs: number;
}

const originalUrl = process.env.RI_DATABASE_URL;
const REUSE_WAIT_MS = READINESS_REUSE_MS + 250;

let relay: TcpRelay;
let getReady: () => Promise<Response>;
let prisma: (typeof import('../../src/lib/prisma/prisma'))['prisma'] | undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function probe(): Promise<Probe> {
  const startedAt = performance.now();
  const response = await getReady();
  const elapsedMs = performance.now() - startedAt;
  return {
    status: response.status,
    body: (await response.json()) as ReadinessBody,
    cacheControl: response.headers.get('cache-control'),
    elapsedMs,
  };
}

/**
 * Brings the path back and waits for a fresh 200. A pooled connection that
 * died during a cut can fail one query before the pool replaces it, so a
 * few fresh evaluations are allowed; a pool that never recovers still fails.
 */
async function expectReadyAgain(evaluations = 3): Promise<void> {
  let last: Probe | undefined;
  for (let attempt = 0; attempt < evaluations; attempt += 1) {
    await sleep(REUSE_WAIT_MS);
    last = await probe();
    if (last.status === 200) break;
  }
  expect(last?.status).toBe(200);
  expect(last?.body.status).toBe('pass');
}

/** Every case starts with nothing silenced, the path forwarding, and a fresh pass. */
async function startFromPassing(): Promise<void> {
  relay.destroyStalled();
  relay.restore();
  await expectReadyAgain();
}

beforeAll(async () => {
  relay = await startTcpRelay();
  process.env.RI_DATABASE_URL = relay.url;
  ({ GET: getReady } = await import('../../src/app/api/health/ready/route'));
  ({ prisma } = await import('../../src/lib/prisma/prisma'));
});

// Each step runs even if an earlier one threw, and the first error is the one
// reported. Silenced sockets go first so no query is still waiting on one when
// the client disconnects. The relay is absent when beforeAll failed to start it.
afterAll(async () => {
  const started = relay as TcpRelay | undefined;
  const errors: unknown[] = [];
  const step = async (run: () => unknown): Promise<void> => {
    try {
      await run();
    } catch (error) {
      errors.push(error);
    }
  };
  if (started !== undefined) {
    await step(() => started.destroyStalled());
    await step(() => started.restore());
  }
  await step(() => prisma?.$disconnect());
  await step(() => {
    if (originalUrl === undefined) delete process.env.RI_DATABASE_URL;
    else process.env.RI_DATABASE_URL = originalUrl;
  });
  if (started !== undefined) await step(() => started.close());
  if (errors.length > 0) throw errors[0];
});

describe('GET /api/health/ready through a relay to the rig database', () => {
  it('a load balancer sees 503 with no connection detail when the database stops, while liveness stays 200, and 200 again once it returns without a restart', async () => {
    await startFromPassing();
    try {
      relay.cut();
      await sleep(REUSE_WAIT_MS);
      const { status, body, cacheControl } = await probe();

      expect(status).toBe(503);
      expect(cacheControl).toBe('no-store');
      expect(body).toEqual({
        status: 'fail',
        timestamp: expect.any(String),
        checks: { database: { status: 'fail' } },
      });

      const live = getLive();
      expect(live.status).toBe(200);
      expect(((await live.json()) as { status: string }).status).toBe('healthy');
    } finally {
      relay.restore();
    }
    await expectReadyAgain();
  });

  it('an orchestrator gets 503 at the check timeout when the database stops answering, and one stranded query cannot hold it there once a working connection exists', async () => {
    await startFromPassing();
    try {
      relay.stall();
      await sleep(REUSE_WAIT_MS);
      const strandedAt = performance.now();
      const stranded = await probe();
      expect(stranded.status).toBe(503);
      expect(stranded.body.checks.database.status).toBe('fail');
      // An immediate rejection or a reused failure cannot reach the lower bound.
      expect(stranded.elapsedMs).toBeGreaterThanOrEqual(READINESS_CHECK_TIMEOUT_MS - 100);
      expect(stranded.elapsedMs).toBeLessThan(READINESS_CHECK_TIMEOUT_MS + 1_500);

      // The stranded socket stays silent from here on.
      relay.restore();

      // While the stranded operation is younger than the replacement age,
      // a fresh evaluation fails at once without sending another query.
      await sleep(REUSE_WAIT_MS);
      const early = await probe();
      expect(performance.now() - strandedAt).toBeLessThan(READINESS_REPLACEMENT_AFTER_MS);
      expect(early.status).toBe(503);
      expect(early.elapsedMs).toBeLessThan(500);

      const replacementDueAt = strandedAt + READINESS_REPLACEMENT_AFTER_MS + REUSE_WAIT_MS;
      await sleep(Math.max(0, replacementDueAt - performance.now()));
      const recovered = await probe();
      expect(recovered.status).toBe(200);
      expect(recovered.body.status).toBe('pass');
    } finally {
      relay.destroyStalled();
      relay.restore();
    }
  }, 25_000);
});
