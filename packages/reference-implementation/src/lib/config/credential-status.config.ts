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
