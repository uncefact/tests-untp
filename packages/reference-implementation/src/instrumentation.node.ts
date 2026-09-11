/**
 * Node-side process boot: shared configuration preflight, database-backed
 * encryption key validation, then queue and OpenTelemetry initialisation.
 *
 * Loaded dynamically by `instrumentation.ts` at process startup when
 * running under the Node.js runtime. `register()` there awaits
 * {@link registerNode}. Configuration that can be checked without the
 * database is shared with the container entrypoint, while a
 * DATA_ENCRYPTION_KEY that cannot decrypt existing data remains here so it
 * can inspect the migrated schema instead of the first request that touches
 * it (#762).
 *
 * @see ../../../docs/observability.md
 * @see ../../../documentation/docs/reference-implementation/operations/startup.md
 */
import { resolveServiceName } from './lib/observability/resource';
import { startNodeSdk } from './lib/observability/start-sdk';
import { apiLogger } from './lib/api/logger';
import { warnOnRejectedMaxPageLimitOverride } from './lib/api/pagination';
import { warnOnRejectedMaxBatchLimitOverride } from './lib/api/batch-limits';
import { validateConfiguredEncryptionKey } from './lib/encryption/encryption-key-boot';
import { startSeededSchemeRefreshInterval } from './lib/cvc/seeded-refresh-interval';
import { runBootPreflight } from './boot/boot-preflight';
import { startJobQueue, stopJobQueue } from './lib/jobs/app-job-queue';

export async function registerNode(): Promise<void> {
  const { key } = await runBootPreflight('web', apiLogger);
  await validateEncryptionKeyOnBoot(key);
  await startJobQueueOnBoot();
  startOpenTelemetry();
  // Periodic refresh of seeded conformity schemes (#728). Validates
  // CVC_REFRESH_INTERVAL_HOURS as part of the fail-fast boot checks above.
  startSeededSchemeRefreshInterval(apiLogger);
}

/**
 * Rechecks the configured key against existing encrypted data after schema
 * convergence. The shared preflight has already resolved the key name and
 * consistency rules, format, and placeholder policy. A keyless web
 * deployment remains valid, while a configured key must still decrypt a
 * database-backed sample before the process serves requests.
 */
async function validateEncryptionKeyOnBoot(key: string | undefined): Promise<void> {
  if (!key) {
    return;
  }
  await validateConfiguredEncryptionKey(key);
}

/**
 * The web process's job queue, started at boot with every queue it sends to
 * created, so the first register call's transactional send is one insert and
 * never holds the caller's transaction open across a queue creation
 * (ADR-054 decision 4). A queue that cannot start fails the boot: it lives in
 * the same database as everything else, so a process that cannot reach it
 * cannot serve much anyway. Handlers are not registered here: the worker
 * process (#985) works the queue; this process only sends.
 */
async function startJobQueueOnBoot(): Promise<void> {
  await startJobQueue();
  const shutdown = () => {
    stopJobQueue().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Job queue shutdown failed', err);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * The OpenTelemetry Node SDK only runs in the Node runtime (guarded by the
 * caller); it does not crash the app on export failure, so running without
 * an observability profile is safe.
 */
function startOpenTelemetry(): void {
  const sdk = startNodeSdk({ serviceName: resolveServiceName() });

  // Surface an unusable API_MAX_PAGE_LIMIT or API_MAX_BATCH_LIMIT to the operator once at startup.
  warnOnRejectedMaxPageLimitOverride(apiLogger);
  warnOnRejectedMaxBatchLimitOverride(apiLogger);

  const shutdown = () => {
    sdk.shutdown().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('OpenTelemetry SDK shutdown failed', err);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
