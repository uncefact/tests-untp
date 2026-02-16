import type { IEncryptionService } from '../../encryption/encryption.interface.js';
import { getSensitiveFields } from './get-sensitive-fields.js';

/**
 * Decrypts a service instance's config and replaces sensitive field values
 * with `'***'` so they are never exposed through the API.
 *
 * Sensitive fields are looked up from the adapter registry.
 * If decryption fails the config is replaced with an error indicator.
 *
 * @param instance          - The service instance with an encrypted config string.
 * @param encryptionService - Encryption service used to decrypt the config.
 */
export function maskInstanceConfig(
  instance: { adapterType: string; config: string; [key: string]: unknown },
  encryptionService: IEncryptionService,
) {
  try {
    const decrypted = encryptionService.decrypt(JSON.parse(instance.config));
    const parsed = JSON.parse(decrypted) as Record<string, unknown>;
    const fields = getSensitiveFields(instance.adapterType);

    for (const field of fields) {
      if (field in parsed) {
        parsed[field] = '***';
      }
    }

    return { ...instance, config: parsed };
  } catch {
    return { ...instance, config: { error: 'Unable to decrypt configuration' } };
  }
}
