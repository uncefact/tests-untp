/**
 * Node-side process boot: encryption key validation, then OpenTelemetry SDK
 * initialisation.
 *
 * Loaded dynamically by `instrumentation.ts` at process startup when
 * running under the Node.js runtime. `register()` there awaits
 * {@link registerNode}, and Next.js does not start serving requests until
 * that promise settles (and crashes startup if it rejects), which is what
 * makes this the right place for a fail-fast check: a DATA_ENCRYPTION_KEY
 * that cannot decrypt existing data is caught here instead of on the first
 * request that happens to touch it (#762).
 *
 * @see ../../../docs/observability.md
 * @see ../../../documentation/docs/reference-implementation/operations/startup.md
 */
import { resolveServiceName } from './lib/observability/resource';
import { startNodeSdk } from './lib/observability/start-sdk';
import { apiLogger } from './lib/api/logger';
import { warnOnRejectedMaxPageLimitOverride } from './lib/api/pagination';
import { resolveDataEncryptionKey } from './lib/encryption/resolve-data-encryption-key';
import { validateConfiguredEncryptionKey } from './lib/encryption/encryption-key-boot';
import { resolveAppUrl } from './lib/config/app-url.config';
import { startSeededSchemeRefreshInterval } from './lib/cvc/seeded-refresh-interval';
import { validateHttpUserAgentOnBoot } from './lib/config/http-user-agent.config';
import { validateCacheMaxEntriesOnBoot } from './lib/config/cache-max-entries.config';
import { validateStaleClaimOnBoot } from './lib/config/idempotency-claim.config';
import { validateMaxRequestBodyBytesOnBoot } from './lib/config/request-body-limit.config';
import { startJobQueue, stopJobQueue } from './lib/jobs/app-job-queue';

export async function registerNode(): Promise<void> {
  // Fail the boot on a missing or unusable RI_APP_URL: it backs the OIDC
  // post-logout redirect and the default human verification link, and the
  // identity-provider documentation requires it (#823).
  resolveAppUrl();
  // Fail the boot on an unsendable RI_HTTP_USER_AGENT override; unset and
  // blank are fine (the guarded fetchers use their built-in default).
  validateHttpUserAgentOnBoot();
  // Fail the boot on an invalid CACHE_MAX_ENTRIES override; unset uses the default.
  validateCacheMaxEntriesOnBoot();
  validateStaleClaimOnBoot();
  validateMaxRequestBodyBytesOnBoot();
  await validateEncryptionKeyOnBoot();
  await startJobQueueOnBoot();
  startOpenTelemetry();
  // Periodic refresh of seeded conformity schemes (#728). Validates
  // CVC_REFRESH_INTERVAL_HOURS as part of the fail-fast boot checks above.
  startSeededSchemeRefreshInterval(apiLogger);
}

/**
 * Skipped entirely when DATA_ENCRYPTION_KEY is not set: a deployment with no
 * encryption configured yet is a supported state (the seed and the service
 * resolution chain both already tolerate it), so there is nothing to
 * validate. `resolveDataEncryptionKey` still throws here for divergent
 * DATA_ENCRYPTION_KEY / SERVICE_ENCRYPTION_KEY values, same as it always
 * has — this just makes that failure surface at boot instead of on first
 * use. The deprecated-name warning is left to `getEncryptionService()`
 * below (it logs the same warning internally) rather than duplicated here.
 */
async function validateEncryptionKeyOnBoot(): Promise<void> {
  const resolved = resolveDataEncryptionKey();
  if (!resolved.key) {
    return;
  }
  await validateConfiguredEncryptionKey(resolved.key);
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

  // Surface an unusable API_MAX_PAGE_LIMIT to the operator once at startup (issue #834).
  warnOnRejectedMaxPageLimitOverride(apiLogger);

  const shutdown = () => {
    sdk.shutdown().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('OpenTelemetry SDK shutdown failed', err);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
