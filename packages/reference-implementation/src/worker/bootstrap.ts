/**
 * The worker's boot, after telemetry is up (#985; ADR-054). Importing this
 * module loads the handler graph and constructs nothing that connects (a
 * `PrismaClient` is built, and connects on its first query); only
 * `runWorker` acts. The image smoke test imports it for exactly that reason.
 *
 * Order: the migrations this build ships (local, so a broken image fails
 * before any network), the database target, schema readiness, the encryption
 * key, then the queue: constructed here rather than through the web's
 * singleton (which starts on construction, and `register` throws after
 * start), handlers registered, shutdown wired before start so a signal in the
 * boot window is handled, started, and finally the heartbeat that is the
 * container's health signal.
 */
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { apiLogger } from '../lib/api/logger';
import { validateConfiguredEncryptionKey } from '../lib/encryption/encryption-key-boot';
import { resolveDataEncryptionKey } from '../lib/encryption/resolve-data-encryption-key';
import { createJobQueue, resolveQueueConnectionString } from '../lib/jobs/app-job-queue';
import type { JobQueue } from '../lib/jobs/types';
import { LIBRARY_RECONCILE_PENDING_RUNS_JOB, LIBRARY_VERIFY_JOB } from '../lib/jobs/queue-names';
import {
  readReconcilePendingRunsBatchSize,
  readReconcilePendingRunsCron,
} from '../lib/config/reconcile-pending-runs.config';
import { readStoredCopyReadTimeoutMs } from '../lib/config/stored-copy-read-timeout.config';
import { registerPendingRunReconciliation } from '../lib/library/reconcile-pending-runs-job';
import { registerLibraryJobs } from '../lib/library/verify-generation-job';
import { prisma } from '../lib/prisma/prisma';
import { WorkerBootError } from './errors';
import { startHeartbeat, type Heartbeat } from './heartbeat';
import { assertSchemaReady, listImageMigrations, prismaMigrationRows } from './schema-readiness';
import { DRAIN_TIMEOUT_MS, TELEMETRY_SHUTDOWN_TIMEOUT_MS, installShutdown, withTimeout } from './shutdown';

export interface RunWorkerOptions {
  sdk: Pick<NodeSDK, 'shutdown'>;
  migrationsDir: string;
}

/**
 * The worker refuses to start without a key. The web may run without one
 * because a keyless deployment has nothing to encrypt; the worker may not,
 * because every job it can ever claim needs the key to unwrap the stored
 * copy's key and to read the verifier's configuration. A check over the
 * tables at boot is not enough: a keyless worker that passed it before the
 * keyed web seeded and accepted a registration would claim that job.
 */
export async function requireEncryptionKeyOnBoot(): Promise<void> {
  const resolved = resolveDataEncryptionKey();
  if (!resolved.key) {
    throw new WorkerBootError(
      'worker.encryption-key-missing',
      'DATA_ENCRYPTION_KEY must be set for the worker: every job it runs needs it, and a worker without it would settle real work as failed',
    );
  }
  await validateConfiguredEncryptionKey(resolved.key);
}

/**
 * Records the reconciliation cron against the live queue. Every other boot
 * step fails with a message naming what is wrong, so this one does too rather
 * than taking the worker down with a raw driver error.
 */
async function scheduleReconciliation(queue: JobQueue, cron: string): Promise<void> {
  try {
    await queue.schedule(LIBRARY_RECONCILE_PENDING_RUNS_JOB, cron);
  } catch (error) {
    throw new WorkerBootError(
      'worker.reconciliation-schedule-failed',
      `The ${LIBRARY_RECONCILE_PENDING_RUNS_JOB} schedule (${cron}) could not be recorded, so pending verification generations would never be reconciled`,
      error,
    );
  }
}

/**
 * Reads the worker's settings before the queue is constructed, so a
 * malformed value fails the boot with the variable named instead of starting
 * a consumer and failing on the first tick or the first job: the sweep
 * cadence, which the schedule step needs, the per-tick cap, which the sweep
 * reads on each tick, and the stored-copy read budget, which every verify
 * job reads. The reader's message already names the variable and the fix,
 * so it is the boot error's message and no cause is attached that would
 * print it twice.
 */
function resolveWorkerConfiguration(): { reconciliationCron: string } {
  try {
    const reconciliationCron = readReconcilePendingRunsCron();
    readReconcilePendingRunsBatchSize();
    readStoredCopyReadTimeoutMs();
    return { reconciliationCron };
  } catch (error) {
    throw new WorkerBootError('worker.configuration-invalid', error instanceof Error ? error.message : String(error));
  }
}

export async function runWorker(options: RunWorkerOptions): Promise<void> {
  const logger = apiLogger.child({ module: 'worker' });

  const imageMigrations = listImageMigrations(options.migrationsDir);

  // The queue and Prisma read the same target. Prisma resolves its datasource
  // from the variable at its first query, not at construction (verified on
  // 6.19.2), which is why publishing a URL built from the RI_POSTGRES_* parts
  // here, after the client module has loaded, still reaches it; nothing
  // queries before this line.
  const connectionString = resolveQueueConnectionString();
  process.env.RI_DATABASE_URL ??= connectionString;

  await assertSchemaReady(prismaMigrationRows(prisma), imageMigrations);
  await requireEncryptionKeyOnBoot();
  const { reconciliationCron } = resolveWorkerConfiguration();

  const queue = createJobQueue();
  registerLibraryJobs(queue);
  registerPendingRunReconciliation(queue);

  let heartbeat: Heartbeat | undefined;
  let shuttingDown = false;
  installShutdown({
    logger,
    steps: [
      // Stops proving but leaves the last proof in place, so a draining
      // worker keeps reading healthy for as long as that proof is inside the
      // check's age limit and retries, which ordinarily covers the drain.
      {
        name: 'heartbeat',
        run: async () => {
          shuttingDown = true;
          heartbeat?.stop();
        },
      },
      { name: 'queue', run: () => queue.stop({ drainTimeoutMs: DRAIN_TIMEOUT_MS }) },
      { name: 'prisma', run: () => prisma.$disconnect() },
      {
        name: 'telemetry',
        run: () => withTimeout(options.sdk.shutdown(), TELEMETRY_SHUTDOWN_TIMEOUT_MS, 'telemetry shutdown'),
        nonCritical: true,
      },
    ],
  });

  await queue.start();

  // A signal during queue.start() has already run the shutdown steps, which
  // stop the queue; do not schedule work on a released pool, and do not start
  // proving health for a process that is on its way out. The flag is read
  // again after the schedule, because a signal can arrive while that call is
  // in flight and the heartbeat would then outlive the shutdown that has
  // already stopped it.
  if (!shuttingDown) {
    await scheduleReconciliation(queue, reconciliationCron);
  }
  if (!shuttingDown) {
    heartbeat = startHeartbeat({ logger, probe: () => queue.probe() });
  }

  logger.info(
    {
      queues: [LIBRARY_VERIFY_JOB, LIBRARY_RECONCILE_PENDING_RUNS_JOB],
      reconciliationCron,
      heartbeat: heartbeat !== undefined,
    },
    heartbeat === undefined
      ? 'Worker handlers registered and queue started; shutting down before the heartbeat began'
      : 'Worker ready; handlers registered, queue started, heartbeat on',
  );
}
