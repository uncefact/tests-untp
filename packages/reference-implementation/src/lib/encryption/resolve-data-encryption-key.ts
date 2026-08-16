import type { LoggerService } from '@uncefact/untp-ri-services';

/**
 * Resolves the data-encryption key from the environment, honouring the
 * deprecated SERVICE_ENCRYPTION_KEY name while it remains supported (#721
 * tracks its removal).
 *
 * Divergent values are a hard failure: the two names are aliases for the
 * same active key, so two different values have no valid operational
 * meaning, and proceeding would split the database across keys (the seed
 * re-encrypts service-instance configurations under whichever key wins).
 * Failing before any write keeps the existing ciphertext recoverable.
 * Moving data to a new key is the rotate:encryption-key maintenance
 * command's job, which reads its key pair directly rather than through
 * this resolver.
 */
export type ResolvedDataEncryptionKey = {
  key: string | undefined;
  /**
   * How the deprecated SERVICE_ENCRYPTION_KEY name participates: 'absent'
   * (not set), 'source' (it alone supplied the key), or 'duplicate' (both
   * names set to the same value).
   */
  deprecatedName: 'absent' | 'source' | 'duplicate';
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

  if (dataKey && serviceKey && dataKey !== serviceKey) {
    throw new Error(
      'DATA_ENCRYPTION_KEY and SERVICE_ENCRYPTION_KEY are both set with different values. ' +
        'These two names are aliases for the same active key, so divergent values would split encrypted ' +
        'data across keys. Remove SERVICE_ENCRYPTION_KEY (or set both to the same value) and restart. ' +
        'To move existing data to a new key, use the rotate:encryption-key maintenance command instead.',
    );
  }

  return {
    key: dataKey ?? serviceKey,
    deprecatedName: serviceKey === undefined ? 'absent' : dataKey ? 'duplicate' : 'source',
  };
}

/**
 * Logs the deprecation warning matching how the deprecated
 * SERVICE_ENCRYPTION_KEY name participated in resolution, shared so the two
 * callers (the app and the seed script) cannot drift onto different wording.
 */
export function warnIfDeprecatedEncryptionKeyName(resolved: ResolvedDataEncryptionKey, logger: LoggerService): void {
  if (resolved.deprecatedName === 'source') {
    logger.warn('SERVICE_ENCRYPTION_KEY is deprecated; rename it to DATA_ENCRYPTION_KEY');
  } else if (resolved.deprecatedName === 'duplicate') {
    logger.warn('SERVICE_ENCRYPTION_KEY duplicates DATA_ENCRYPTION_KEY; remove the deprecated name');
  }
}
