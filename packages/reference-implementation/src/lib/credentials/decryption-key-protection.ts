import { EncryptionAlgorithm, isEncryptedEnvelope } from '@uncefact/untp-ri-services/encryption';
import type { EncryptedEnvelope } from '@uncefact/untp-ri-services/encryption';
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { getEncryptionService } from '../encryption/encryption';
import { apiLogger } from '../api/logger';

const logger = apiLogger.child({ module: 'decryption-key-protection' });

/**
 * Wraps a storage-service decryption key in an AES-256-GCM envelope for
 * persistence, so the raw database row does not expose a usable key.
 */
export function protectDecryptionKey(key: string): string;
export function protectDecryptionKey(key: string | undefined): string | undefined;
export function protectDecryptionKey(key: string | undefined): string | undefined {
  if (key === undefined) {
    return undefined;
  }
  return JSON.stringify(getEncryptionService().encrypt(key, EncryptionAlgorithm.AES_256_GCM));
}

/**
 * Whether a persisted decryption key value is already an encrypted envelope,
 * as opposed to a plaintext key written before keys were encrypted at rest.
 */
export function isProtectedDecryptionKey(stored: string): boolean {
  return parseEnvelope(stored) !== null;
}

/**
 * Recovers the plaintext decryption key from its persisted form.
 *
 * Rows written before the key was encrypted at rest hold the plaintext key
 * directly; anything that is not an encrypted envelope is returned unchanged.
 *
 * Throws when a stored envelope cannot be decrypted, for example when
 * `DATA_ENCRYPTION_KEY` has changed since the credential was stored.
 */
export function revealDecryptionKey(stored: string | null): string | null {
  if (stored === null) {
    return null;
  }

  const envelope = parseEnvelope(stored);
  if (envelope === null) {
    warnIfEnvelopeLike(stored);
    return stored;
  }

  // Resolved outside the decrypt try/catch so a missing or malformed
  // DATA_ENCRYPTION_KEY surfaces its own precise error rather than the
  // key-mismatch message below.
  const encryptionService = getEncryptionService();

  try {
    return encryptionService.decrypt(envelope);
  } catch (error) {
    logger.error({ err: error }, 'Failed to decrypt stored credential decryption key');
    throw new Error(
      'Failed to decrypt the stored credential decryption key. ' +
        'DATA_ENCRYPTION_KEY may not match the key in use when the credential was stored.',
      { cause: error },
    );
  }
}

/**
 * Whether a stored value resembles an encrypted envelope without being one
 * (for example a truncated or corrupted envelope). Such values are neither
 * decryptable nor plausible legacy plaintext, so writers must not re-encrypt
 * them as if they were legitimate keys.
 */
export function looksEnvelopeLikeButInvalid(stored: string): boolean {
  return stored.startsWith('{') && parseEnvelope(stored) === null;
}

function parseEnvelope(stored: string): EncryptedEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  return isEncryptedEnvelope(parsed) ? parsed : null;
}

function warnIfEnvelopeLike(stored: string): void {
  if (stored.startsWith('{')) {
    logger.warn(
      'Stored decryption key resembles an encrypted envelope but could not be parsed as one; treating it as a legacy plaintext key',
    );
  }
}
