import { SUPPORTED_STATUS_PURPOSES, type SupportedStatusPurpose } from '@/lib/credentials/status-purposes';
import type { LoggerService } from '@uncefact/untp-ri-services/logging';

const DEFAULT_STATUS_PURPOSES = ['revocation'] as const;
const STATUS_PURPOSES_ENV_NAME = 'DEFAULT_STATUS_PURPOSES';
export const DEFAULT_STATUS_LOCK_ACQUIRE_MS = 2_000;
const STATUS_LOCK_ACQUIRE_ENV_NAME = 'STATUS_LOCK_ACQUIRE_MS';
const SUPPORTED_STATUS_PURPOSES_SET = new Set<string>(SUPPORTED_STATUS_PURPOSES);
const NO_STATUS_WARNING =
  'DEFAULT_STATUS_PURPOSES=none: credentials issued without an explicit statusPurposes carry no status entry and can never be revoked or suspended.';

function invalidStatusPurposes(raw: string, reason: string): Error {
  return new Error(
    `${STATUS_PURPOSES_ENV_NAME} has invalid value "${raw}" (${reason}). Accepted values: ${SUPPORTED_STATUS_PURPOSES.join(
      ', ',
    )}.`,
  );
}

/**
 * Reads the deployment default used when credential issuance omits
 * `statusPurposes`. Invalid configured values fail closed so startup and
 * issuance cannot silently disagree about the purposes a deployment mints.
 */
export function readDefaultStatusPurposes(
  env: Record<string, string | undefined> = process.env,
): readonly SupportedStatusPurpose[] {
  const raw = env[STATUS_PURPOSES_ENV_NAME];
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_STATUS_PURPOSES];
  if (raw.trim().toLowerCase() === 'none') return [];

  const purposes = raw
    .split(',')
    .map((purpose) => purpose.trim())
    .filter((purpose) => purpose !== '');
  if (purposes.length === 0) {
    throw invalidStatusPurposes(raw, 'the list must contain at least one purpose');
  }

  const seen = new Set<string>();
  for (const purpose of purposes) {
    if (purpose.toLowerCase() === 'none') {
      throw invalidStatusPurposes(raw, 'none must be the only value');
    }
    if (!SUPPORTED_STATUS_PURPOSES_SET.has(purpose)) {
      throw invalidStatusPurposes(raw, `unsupported purpose "${purpose}"`);
    }
    if (seen.has(purpose)) {
      throw invalidStatusPurposes(raw, `duplicate purpose "${purpose}"`);
    }
    seen.add(purpose);
  }

  const [first, ...rest] = purposes;
  return [first as SupportedStatusPurpose, ...(rest as SupportedStatusPurpose[])];
}

/** Validates status-related deployment settings during web boot. */
export function validateStatusSettingsOnBoot(
  env: Record<string, string | undefined> = process.env,
  logger?: Pick<LoggerService, 'warn'>,
): void {
  const enabled = env.STATUS_MUTATION_ENABLED;
  if (enabled !== undefined && enabled !== '' && enabled !== 'true' && enabled !== 'false') {
    throw new Error('STATUS_MUTATION_ENABLED must be true or false.');
  }
  readStatusOperationBudgetMs(env);
  readStatusReconcileGraceMs(env);
  const purposes = readDefaultStatusPurposes(env);
  if (purposes.length === 0 && env[STATUS_PURPOSES_ENV_NAME]?.trim().toLowerCase() === 'none') {
    logger?.warn(NO_STATUS_WARNING);
  }
  const rawAcquireMs = env[STATUS_LOCK_ACQUIRE_ENV_NAME];
  if (rawAcquireMs === undefined || rawAcquireMs.trim() === '') return;
  // Same parse as the mutex (`Number.parseInt`), so this warning fires exactly when the mutex falls back.
  const acquireMs = Number.parseInt(rawAcquireMs, 10);
  if (!Number.isInteger(acquireMs) || acquireMs <= 0) {
    logger?.warn(
      `${STATUS_LOCK_ACQUIRE_ENV_NAME} has invalid value "${rawAcquireMs}"; using the default ${DEFAULT_STATUS_LOCK_ACQUIRE_MS} milliseconds.`,
    );
  }
}

const DEFAULT_STATUS_OPERATION_BUDGET_MS = 30_000;
const DEFAULT_STATUS_RECONCILE_GRACE_MS = 5_000;

function readStatusDuration(name: string, fallback: number, env: Record<string, string | undefined>): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!/^[0-9]+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`${name} must be an integer between 1 and 2147483647 milliseconds.`);
  }
  return value;
}

/** The operation deadline bounds all provider calls, including lock acquisition. */
export function readStatusOperationBudgetMs(env: Record<string, string | undefined> = process.env): number {
  return readStatusDuration('STATUS_OPERATION_BUDGET_MS', DEFAULT_STATUS_OPERATION_BUDGET_MS, env);
}

/** Reconciliation waits this long after a pending operation's deadline. */
export function readStatusReconcileGraceMs(env: Record<string, string | undefined> = process.env): number {
  return readStatusDuration('STATUS_RECONCILE_GRACE_MS', DEFAULT_STATUS_RECONCILE_GRACE_MS, env);
}
