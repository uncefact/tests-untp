import type { IEncryptionService } from '../../encryption/encryption.interface.js';
import { getSensitiveFields } from './get-sensitive-fields.js';

/**
 * Decrypts a service instance's config and replaces sensitive field values
 * with `'***'` so they are never exposed through the API.
 *
 * Sensitive fields are looked up from the adapter registry via
 * {@link getSensitiveFields}. If decryption fails the config is replaced
 * with an error indicator and the error is logged when a logger is provided.
 *
 * @param instance          - The service instance with an encrypted config string.
 * @param encryptionService - Encryption service used to decrypt the config.
 * @param logger            - Logger; receives an error entry when decryption fails.
 * @returns A copy of the instance with `config` replaced by the decrypted and
 *          masked plain object. If decryption fails, `config` is
 *          `{ error: 'Unable to decrypt configuration' }`.
 */
export function maskInstanceConfig(
  instance: { adapterType: string; config: string; [key: string]: unknown },
  encryptionService: IEncryptionService,
  logger: { error(obj: Record<string, unknown>, msg: string): void },
): { config: Record<string, unknown>; [key: string]: unknown } {
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
  } catch (error) {
    logger.error({ error, adapterType: instance.adapterType }, 'Failed to decrypt and mask service instance config');
    return { ...instance, config: { error: 'Unable to decrypt configuration' } };
  }
}
