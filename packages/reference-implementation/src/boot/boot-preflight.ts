import { AesGcmEncryptionAdapter } from '@uncefact/untp-ri-services/encryption';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import type { LoggerService } from '@uncefact/untp-ri-services/logging';
import { validateBundledArtefactsFallbackOnBoot } from '../lib/config/bundled-artefacts-fallback.config';
import { validateFetchSettingsOnBoot } from '../lib/config/credential-fetch.config';
import { resolveAppUrl } from '../lib/config/app-url.config';
import { validateHttpUserAgentOnBoot } from '../lib/config/http-user-agent.config';
import { validateStaleClaimOnBoot } from '../lib/config/idempotency-claim.config';
import { validateMaxRequestBodyBytesOnBoot } from '../lib/config/request-body-limit.config';
import { validateCacheMaxEntriesOnBoot } from '../lib/config/cache-max-entries.config';
import { resolveRefreshIntervalHours } from '../lib/config/cvc-refresh-interval.config';
import { resolveServiceName } from '../lib/observability/resource';
import { readWorkerJobTimeoutSeconds } from '../lib/config/worker-job-timeout.config';
import {
  resolveDataEncryptionKey,
  type ResolvedDataEncryptionKey,
} from '../lib/encryption/resolve-data-encryption-key';
import { resolveWorkerConfiguration, type WorkerConfiguration } from '../worker/configuration';
import { WorkerBootError } from '../worker/errors';

export type BootProcessRole = 'web' | 'worker';

export type BootPreflightResult = ResolvedDataEncryptionKey;
export type WorkerBootPreflightResult = BootPreflightResult & { workerConfiguration: WorkerConfiguration };

export function resolveBootProcessRole(value: string | undefined = process.env.RI_PROCESS_ROLE): BootProcessRole {
  if (value === undefined || value === '') return 'web';
  if (value === 'web' || value === 'worker') return value;
  throw new Error('RI_PROCESS_ROLE must be "web" or "worker" when set; fix or unset it.');
}

/**
 * Runs the environment-only part of the node boot contract before schema
 * convergence. The encryption checks here validate the key name, format and
 * placeholder policy. The database-backed check against existing encrypted
 * data stays after migrations in the web registration and worker bootstrap,
 * because a pre-upgrade or first-boot database may not have the tables it
 * needs yet.
 *
 * @see ../../../../docs/adrs/045-seed-fails-loudly-on-missing-configuration.md
 */
export function runBootPreflight(role: 'web', logger?: LoggerService): Promise<BootPreflightResult>;
export function runBootPreflight(role: 'worker', logger?: LoggerService): Promise<WorkerBootPreflightResult>;
export function runBootPreflight(
  role: BootProcessRole,
  logger?: LoggerService,
): Promise<BootPreflightResult | WorkerBootPreflightResult>;
export async function runBootPreflight(
  role: BootProcessRole = 'web',
  logger: LoggerService = createLogger(),
): Promise<BootPreflightResult | WorkerBootPreflightResult> {
  if (role === 'web') {
    resolveAppUrl();
  }
  validateHttpUserAgentOnBoot();
  validateCacheMaxEntriesOnBoot();
  validateBundledArtefactsFallbackOnBoot();
  if (role === 'web') {
    validateStaleClaimOnBoot();
    validateMaxRequestBodyBytesOnBoot();
    validateFetchSettingsOnBoot(logger);
  }

  if (role === 'web') {
    resolveRefreshIntervalHours();
  }

  const resolved = resolveDataEncryptionKey();
  if (resolved.key) {
    validateDataEncryptionKeyFormat(resolved.key, logger);
    const { assertNotPlaceholderEncryptionKey } = await import('../lib/credentials/validate-encryption-key-startup');
    assertNotPlaceholderEncryptionKey(resolved.key, {
      deploymentEnvironment: process.env.DEPLOYMENT_ENVIRONMENT,
    });
  }
  await validateOtelExporterConfiguration();

  if (role === 'worker') {
    assertWorkerEncryptionKeyConfigured(resolved);
    return { ...resolved, workerConfiguration: resolveWorkerConfiguration() };
  }
  readWorkerJobTimeoutSeconds();
  return resolved;
}

function validateDataEncryptionKeyFormat(key: string, logger: LoggerService): void {
  try {
    new AesGcmEncryptionAdapter(key, logger);
  } catch (error) {
    throw new Error(
      'DATA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).',
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

/**
 * Exercises the exact SDK construction used by `startNodeSdk`. This starts no
 * SDK and exports no telemetry. When `OTEL_METRICS_EXPORTER=prometheus`, the
 * preflight skips constructing that exporter because its setting has no gRPC
 * metadata to validate; constructing it would bind its metrics server.
 * Other installed exporter transports defer network clients until export, and
 * the SDK registers providers only from `start()`.
 */
async function validateOtelExporterConfiguration(): Promise<void> {
  try {
    const { buildNodeSdk } = await import('../lib/observability/start-sdk');
    const sdkOverrides = process.env.OTEL_METRICS_EXPORTER === 'prometheus' ? { metricReaders: [] } : undefined;
    buildNodeSdk({ serviceName: resolveServiceName() }, sdkOverrides);
  } catch (error) {
    const settings = [
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
      'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
      'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
      'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
      'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
      'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
      'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
      'OTEL_EXPORTER_OTLP_PROTOCOL',
    ].filter((name) => process.env[name] !== undefined);
    const settingNames = settings.length > 0 ? settings.join(', ') : 'OTEL_EXPORTER_OTLP_ENDPOINT';
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${settingNames} contains a value the exporter cannot use: ${reason}; fix or unset it.`, {
      cause: error,
    });
  }
}

/**
 * Keeps the worker's key-presence contract shared between the preflight and
 * the database-backed worker boot check. It deliberately does not inspect
 * existing data.
 */
export function assertWorkerEncryptionKeyConfigured(resolved: ResolvedDataEncryptionKey): string {
  if (!resolved.key) {
    throw new WorkerBootError(
      'worker.encryption-key-missing',
      'DATA_ENCRYPTION_KEY must be set for the worker: every job it runs needs it, and a worker without it would settle real work as failed',
    );
  }
  return resolved.key;
}
