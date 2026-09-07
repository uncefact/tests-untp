import type { LoggerService } from '@uncefact/untp-ri-services';

/**
 * Resolves the data-encryption key from the environment. The key comes from
 * DATA_ENCRYPTION_KEY alone: the deprecated SERVICE_ENCRYPTION_KEY name
 * (renamed in v0.4, fallback removed in v0.5 per #721) is never a key
 * source any more.
 *
 * The deprecated name is still detected so its removal fails loud instead
 * of silently stranding an operator's key. A deployment that still sets
 * only SERVICE_ENCRYPTION_KEY would otherwise start keyless, and every
 * failure after that point (seed preflight, startup key validation, first
 * decrypt) names a missing DATA_ENCRYPTION_KEY without saying the operator
 * already has the value under the old name. Throwing here, before any
 * write, turns that into a one-line rename.
 *
 * Both names set to the SAME value is a leftover worth a warning. Both set
 * to DIFFERENT values is still a hard failure, as in v0.4, but for a new
 * reason: the old name is not a key, so this process cannot tell which of
 * the two values the operator intended. Proceeding would
 * pick DATA_ENCRYPTION_KEY silently, and on a database with nothing
 * encrypted yet (where startup validation has no envelope to test against)
 * the seed would then write under a value the operator may never have
 * intended. Refusing before any I/O keeps that choice with the operator.
 * The rotation command deliberately reads its variables directly, because a
 * rotation environment legitimately carries a leftover old value that
 * differs from the new DATA_ENCRYPTION_KEY.
 */
export type ResolvedDataEncryptionKey = {
  key: string | undefined;
  /**
   * How the deprecated SERVICE_ENCRYPTION_KEY name appears in the
   * environment: 'absent' (not set), or 'stale' (set alongside
   * DATA_ENCRYPTION_KEY with the same value; ignored, worth removing). A
   * differing value never resolves; it throws.
   */
  deprecatedName: 'absent' | 'stale';
};

/**
 * A whitespace-only value has no legitimate meaning here, the same rule
 * `seed-preflight.ts`'s `normalizeEnvValue` applies; duplicated rather than
 * imported because `seed-preflight.ts` already imports this module, and a
 * cross-import back would be circular.
 */
function normalizeWhitespaceOnly(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

export function resolveDataEncryptionKey(env: NodeJS.ProcessEnv = process.env): ResolvedDataEncryptionKey {
  const dataKey = normalizeWhitespaceOnly(env.DATA_ENCRYPTION_KEY);
  const serviceKey = normalizeWhitespaceOnly(env.SERVICE_ENCRYPTION_KEY);

  if (serviceKey && !dataKey) {
    throw new Error(
      'SERVICE_ENCRYPTION_KEY is set but is no longer read (it was deprecated in v0.4 and removed in v0.5). ' +
        'Rename it to DATA_ENCRYPTION_KEY and restart. The value does not change, only the name.',
    );
  }

  if (dataKey && serviceKey && serviceKey !== dataKey) {
    throw new Error(
      'DATA_ENCRYPTION_KEY and SERVICE_ENCRYPTION_KEY are both set with different values. SERVICE_ENCRYPTION_KEY is ' +
        'no longer read as a key (deprecated in v0.4, removed in v0.5), so only DATA_ENCRYPTION_KEY would be used, and ' +
        'this process cannot tell which value you intended. If the SERVICE_ENCRYPTION_KEY value is your real key, set ' +
        'DATA_ENCRYPTION_KEY to that value and remove SERVICE_ENCRYPTION_KEY. If DATA_ENCRYPTION_KEY is already the real ' +
        'key (including after a completed rotation), remove SERVICE_ENCRYPTION_KEY. Never switch an active key in place ' +
        'once encrypted data exists under it; the rotate:encryption-key maintenance command moves data between keys and ' +
        'reads its own variables, so it is unaffected by this check.',
    );
  }

  return {
    key: dataKey,
    deprecatedName: serviceKey === undefined ? 'absent' : 'stale',
  };
}

/**
 * Logs the warning for a stale SERVICE_ENCRYPTION_KEY left set alongside
 * DATA_ENCRYPTION_KEY, shared so the two callers (the app and the seed
 * script) cannot drift onto different wording.
 */
export function warnIfDeprecatedEncryptionKeyName(resolved: ResolvedDataEncryptionKey, logger: LoggerService): void {
  if (resolved.deprecatedName === 'stale') {
    logger.warn('SERVICE_ENCRYPTION_KEY is set but no longer read; remove it (DATA_ENCRYPTION_KEY is the active key)');
  }
}
