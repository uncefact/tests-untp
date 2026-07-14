import { AesGcmEncryptionAdapter } from '@uncefact/untp-ri-services/encryption';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { resolveDataEncryptionKey, warnIfDeprecatedEncryptionKeyName } from './resolve-data-encryption-key';

const logger = createLogger().child({ module: 'encryption' });

let cached: AesGcmEncryptionAdapter | null = null;

export function getEncryptionService(): AesGcmEncryptionAdapter {
  if (cached) return cached;

  const resolved = resolveDataEncryptionKey();
  warnIfDeprecatedEncryptionKeyName(resolved, logger);
  if (!resolved.key) {
    throw new Error(
      'Missing required DATA_ENCRYPTION_KEY environment variable. ' + 'Set this in your .env file or environment.',
    );
  }

  cached = new AesGcmEncryptionAdapter(resolved.key, logger);
  return cached;
}
