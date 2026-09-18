import { SUPPORTED_STATUS_PURPOSES, type SupportedStatusPurpose } from '@/lib/credentials/status-purposes';
import type { LoggerService } from '@uncefact/untp-ri-services/logging';

const CREDENTIAL_STATUS_DEFAULT_PURPOSES = ['revocation'] as const;
const CREDENTIAL_STATUS_DEFAULT_PURPOSES_ENV_NAME = 'CREDENTIAL_STATUS_DEFAULT_PURPOSES';
const CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED_ENV_NAME = 'CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED';
export const CREDENTIAL_STATUS_DEFAULT_LOCK_ACQUIRE_MS = 2_000;
const CREDENTIAL_STATUS_LOCK_ACQUIRE_ENV_NAME = 'CREDENTIAL_STATUS_LOCK_ACQUIRE_MS';
const SUPPORTED_STATUS_PURPOSES_SET = new Set<string>(SUPPORTED_STATUS_PURPOSES);
const NO_STATUS_WARNING =
  'CREDENTIAL_STATUS_DEFAULT_PURPOSES=none: credentials issued without an explicit statusPurposes carry no status entry and can never be revoked or suspended.';

function invalidStatusPurposes(raw: string, reason: string): Error {
  return new Error(
    `${CREDENTIAL_STATUS_DEFAULT_PURPOSES_ENV_NAME} has invalid value "${raw}" (${reason}). Accepted values: ${SUPPORTED_STATUS_PURPOSES.join(
      ', ',
    )}.`,
  );
}

/**
 * Reads the opt-in for multi-purpose issuance. The default is one purpose
 * because the UNTP v0.7.0 schemas accept one `credentialStatus` object; see
 * ADR-058 for the issuer-status decision.
 */
export function readStatusMultiplePurposesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED_ENV_NAME];
  if (raw === undefined || raw === '') return false;
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`${CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED_ENV_NAME} must be true or false.`);
  }
  return raw === 'true';
}

/**
 * Reads the deployment default used when credential issuance omits
 * `statusPurposes`. Invalid configured values fail closed so startup and
 * issuance cannot silently disagree about the purposes a deployment mints.
 */
export function readDefaultStatusPurposes(
  env: Record<string, string | undefined> = process.env,
): readonly SupportedStatusPurpose[] {
  const raw = env[CREDENTIAL_STATUS_DEFAULT_PURPOSES_ENV_NAME];
  if (raw === undefined || raw.trim() === '') return [...CREDENTIAL_STATUS_DEFAULT_PURPOSES];
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

export function readStatusMutationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CREDENTIAL_STATUS_MUTATION_ENABLED === 'true';
}

export function readStatusLockAcquireMs(
  env: Record<string, string | undefined> = process.env,
  onInvalid?: (raw: string) => void,
): number {
  const raw = env[CREDENTIAL_STATUS_LOCK_ACQUIRE_ENV_NAME];
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (raw !== undefined && raw.trim() !== '') onInvalid?.(raw);
  return CREDENTIAL_STATUS_DEFAULT_LOCK_ACQUIRE_MS;
}

/** Validates status-related deployment settings during web boot. */
export function validateStatusSettingsOnBoot(
  env: Record<string, string | undefined> = process.env,
  logger?: Pick<LoggerService, 'warn'>,
): void {
  const enabled = env.CREDENTIAL_STATUS_MUTATION_ENABLED;
  if (enabled !== undefined && enabled !== '' && enabled !== 'true' && enabled !== 'false') {
    throw new Error('CREDENTIAL_STATUS_MUTATION_ENABLED must be true or false.');
  }
  const multiplePurposesEnabled = readStatusMultiplePurposesEnabled(env);
  readStatusOperationBudgetMs(env);
  readStatusReconcileGraceMs(env);
  const purposes = readDefaultStatusPurposes(env);
  if (!multiplePurposesEnabled && purposes.length > 1) {
    throw new Error(
      'CREDENTIAL_STATUS_DEFAULT_PURPOSES names more than one purpose, but CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED is false. ' +
        'UNTP v0.7.0 schemas accept one credentialStatus object, so set CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED=true to enable multiple purposes.',
    );
  }
  if (purposes.length === 0 && env[CREDENTIAL_STATUS_DEFAULT_PURPOSES_ENV_NAME]?.trim().toLowerCase() === 'none') {
    logger?.warn(NO_STATUS_WARNING);
  }
  readStatusLockAcquireMs(
    env,
    (raw) =>
      logger?.warn(
        `${CREDENTIAL_STATUS_LOCK_ACQUIRE_ENV_NAME} has invalid value "${raw}"; using the default ${CREDENTIAL_STATUS_DEFAULT_LOCK_ACQUIRE_MS} milliseconds.`,
      ),
  );
}

const DEFAULT_CREDENTIAL_STATUS_OPERATION_BUDGET_MS = 30_000;
const DEFAULT_CREDENTIAL_STATUS_RECONCILE_GRACE_MS = 5_000;

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
  return readStatusDuration(
    'CREDENTIAL_STATUS_OPERATION_BUDGET_MS',
    DEFAULT_CREDENTIAL_STATUS_OPERATION_BUDGET_MS,
    env,
  );
}

/** Reconciliation waits this long after a pending operation's deadline. */
export function readStatusReconcileGraceMs(env: Record<string, string | undefined> = process.env): number {
  return readStatusDuration('CREDENTIAL_STATUS_RECONCILE_GRACE_MS', DEFAULT_CREDENTIAL_STATUS_RECONCILE_GRACE_MS, env);
}
