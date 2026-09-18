import { readMaxRequestBodyBytes } from './request-body-limit.config';

export const DEFAULT_MAX_BATCH_ITEMS = 500;
export const DEFAULT_MAX_BATCH_REQUEST_BODY_BYTES = 52_428_800;
export const DEFAULT_BATCH_RETENTION_DAYS = 30;
export const DEFAULT_BATCH_EXPIRY_SWEEP_MINUTES = 60;

function readPositiveInteger(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer when set; fix or unset it (unset uses ${fallback}).`);
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
  readBatchRetentionDays(env);
  readBatchExpirySweepCron(env);
}

/** Validates the web-only raw batch body setting during boot. */
export function validateCredentialBatchRequestBodySettingsOnWebBoot(
  env: Record<string, string | undefined> = process.env,
): void {
  readMaxBatchRequestBodyBytes(env);
}
