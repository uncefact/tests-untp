import { readMaxRequestBodyBytes } from './request-body-limit.config';
import { readWorkerJobTimeoutSeconds } from './worker-job-timeout.config';

export const DEFAULT_MAX_BATCH_ITEMS = 500;
export const DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES = 52_428_800;
export const DEFAULT_BATCH_RETENTION_DAYS = 30;
export const DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES = 60;
export const DEFAULT_BATCH_SETTLEMENT_ALLOWANCE_MS = 5_000;
export const DEFAULT_BATCH_MINIMUM_ITEM_COST_MS = 2_000;
export const DEFAULT_BATCH_JOB_RETRY_LIMIT = 4;
export const DEFAULT_BATCH_JOB_RETRY_BACKOFF_SECONDS = 30;
export const DEFAULT_BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS = 600;
const MAX_PG_BOSS_INTEGER = 2_147_483_647;

export type CredentialBatchBudgetSettings = {
  settlementAllowanceMs: number;
  minimumItemCostMs: number;
};

export type CredentialBatchIssueEnqueueOptions = {
  retry: {
    limit: number;
    backoffSeconds: number;
    backoffMaxSeconds: number;
  };
};

let credentialBatchIssueEnqueueOptions: CredentialBatchIssueEnqueueOptions | undefined;

function readPositiveInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  maximum?: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer when set; fix or unset it (unset uses ${fallback}).`);
  }
  if (maximum !== undefined && parsed > maximum) {
    throw new Error(
      `${name} must be a positive integer no greater than ${maximum} when set; fix or unset it (unset uses ${fallback}).`,
    );
  }
  return parsed;
}

/** Maximum number of credential requests accepted in one batch. */
export function readMaxBatchItems(env: Record<string, string | undefined> = process.env): number {
  return readPositiveInteger(env, 'MAX_BATCH_ITEMS', DEFAULT_MAX_BATCH_ITEMS);
}

/** Maximum raw request body size accepted by the batch submission endpoint. */
export function readMaxBatchRequestBodyBytes(env: Record<string, string | undefined> = process.env): number {
  const maxBytes = readPositiveInteger(env, 'MAX_BATCH_REQUEST_BODY_BYTES', DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES);
  const singleRequestLimit = readMaxRequestBodyBytes(env);
  if (maxBytes < singleRequestLimit) {
    throw new Error(
      `MAX_BATCH_REQUEST_BODY_BYTES must be at least MAX_REQUEST_BODY_BYTES (${singleRequestLimit}) when set; fix or unset it (unset uses ${DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES}).`,
    );
  }
  return maxBytes;
}

/** Number of days settled batches remain as readable records before tombstoning. */
export function readBatchRetentionDays(env: Record<string, string | undefined> = process.env): number {
  return readPositiveInteger(env, 'BATCH_RETENTION_DAYS', DEFAULT_BATCH_RETENTION_DAYS);
}

/** Number of minutes between worker sweeps for settled batches past retention. */
export function readBatchExpirySweepMinutes(env: Record<string, string | undefined> = process.env): number {
  return readPositiveInteger(env, 'BATCH_EXPIRY_SWEEP_MINUTES', DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES);
}

/** Reads the retry policy shared by batch jobs and their per-item fault ladder. */
export function readCredentialBatchIssueEnqueueOptions(
  env: Record<string, string | undefined> = process.env,
): CredentialBatchIssueEnqueueOptions {
  const limit = readPositiveInteger(env, 'BATCH_JOB_RETRY_LIMIT', DEFAULT_BATCH_JOB_RETRY_LIMIT, MAX_PG_BOSS_INTEGER);
  const backoffSeconds = readPositiveInteger(
    env,
    'BATCH_JOB_RETRY_BACKOFF_SECONDS',
    DEFAULT_BATCH_JOB_RETRY_BACKOFF_SECONDS,
    MAX_PG_BOSS_INTEGER,
  );
  const backoffMaxSeconds = readPositiveInteger(
    env,
    'BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS',
    DEFAULT_BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS,
    MAX_PG_BOSS_INTEGER,
  );
  if (backoffMaxSeconds < backoffSeconds) {
    throw new Error(
      `BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS must be at least BATCH_JOB_RETRY_BACKOFF_SECONDS (${backoffSeconds}) when set; fix or unset it (unset uses ${DEFAULT_BATCH_JOB_RETRY_BACKOFF_MAX_SECONDS}).`,
    );
  }
  return { retry: { limit, backoffSeconds, backoffMaxSeconds } };
}

/** Reads and retains the process retry policy for queue sends and item faults. */
export function getCredentialBatchIssueEnqueueOptions(): CredentialBatchIssueEnqueueOptions {
  if (credentialBatchIssueEnqueueOptions === undefined) {
    credentialBatchIssueEnqueueOptions = readCredentialBatchIssueEnqueueOptions();
  }
  return credentialBatchIssueEnqueueOptions;
}

/** Returns the delay after the supplied one-based item fault count. */
export function credentialBatchItemBackoffSeconds(
  attemptCount: number,
  options: CredentialBatchIssueEnqueueOptions = getCredentialBatchIssueEnqueueOptions(),
): number {
  return Math.min(options.retry.backoffMaxSeconds, options.retry.backoffSeconds * 2 ** Math.max(0, attemptCount - 1));
}

/** Returns the maximum number of pre-dispatch attempts for one item. */
export function credentialBatchItemAttemptLimit(
  options: CredentialBatchIssueEnqueueOptions = getCredentialBatchIssueEnqueueOptions(),
): number {
  return options.retry.limit;
}

/** Minimum item cost used when deciding whether another batch item fits the job budget. */
export function readBatchMinimumItemCostMs(env: Record<string, string | undefined> = process.env): number {
  return readPositiveInteger(env, 'BATCH_MINIMUM_ITEM_COST_MS', DEFAULT_BATCH_MINIMUM_ITEM_COST_MS);
}

/** Time held back from each batch job for its settlement checkpoint. */
export function readBatchSettlementAllowanceMs(env: Record<string, string | undefined> = process.env): number {
  return readBatchBudgetSettings(env).settlementAllowanceMs;
}

/** Reads and validates the worker budget values used by the batch issue handler. */
export function readBatchBudgetSettings(
  env: Record<string, string | undefined> = process.env,
): CredentialBatchBudgetSettings {
  const settlementAllowanceMs = readPositiveInteger(
    env,
    'BATCH_SETTLEMENT_ALLOWANCE_MS',
    DEFAULT_BATCH_SETTLEMENT_ALLOWANCE_MS,
  );
  const minimumItemCostMs = readBatchMinimumItemCostMs(env);
  const workerJobTimeoutSeconds = readWorkerJobTimeoutSeconds(env);
  const maximumAllowanceMs = workerJobTimeoutSeconds * 1_000 - minimumItemCostMs;
  if (settlementAllowanceMs >= maximumAllowanceMs) {
    throw new Error(
      `BATCH_SETTLEMENT_ALLOWANCE_MS must be less than WORKER_JOB_TIMEOUT_SECONDS * 1000 - BATCH_MINIMUM_ITEM_COST_MS (${workerJobTimeoutSeconds} * 1000 - ${minimumItemCostMs} = ${maximumAllowanceMs}) when set; the allowance must leave more than one minimum item cost inside the job timeout, otherwise every job attempts a single item and re-enqueues.`,
    );
  }
  return { settlementAllowanceMs, minimumItemCostMs };
}

/** Converts the minute cadence to a cron expression accepted by pg-boss. */
export function readBatchExpirySweepCron(env: Record<string, string | undefined> = process.env): string {
  const minutes = readBatchExpirySweepMinutes(env);
  if (minutes < 60) return `*/${minutes} * * * *`;
  if (minutes % 60 !== 0) {
    throw new Error(
      `BATCH_EXPIRY_SWEEP_MINUTES must be less than 60 or a multiple of 60 when set; fix or unset it (unset uses ${DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES}).`,
    );
  }
  const hours = minutes / 60;
  return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
}

/** Validates batch settings during the shared web and worker boot preflight. */
export function validateCredentialBatchSettingsOnBoot(env: Record<string, string | undefined> = process.env): void {
  readMaxBatchItems(env);
  readCredentialBatchIssueEnqueueOptions(env);
}

/** Validates the web-only raw batch body setting during boot. */
export function validateCredentialBatchRequestBodySettingsOnWebBoot(
  env: Record<string, string | undefined> = process.env,
): void {
  readMaxBatchRequestBodyBytes(env);
}
