import { permittedAlgorithms } from './encryption.interface.js';
import type { EncryptedEnvelope } from './encryption.interface.js';

/**
 * Checks whether the given value is a well-formed encrypted envelope: has
 * cipherText, iv, and tag fields that are strings, and a type field naming
 * a permitted algorithm. Field presence alone is not enough — a value with
 * the right keys but null or wrongly-typed fields (or an unsupported
 * algorithm) is not decryptable data, and treating it as a genuine envelope
 * sends a caller into `decrypt()`, which fails with a confusing crypto
 * error (or "Unsupported algorithm: ...") that reads as a key problem
 * rather than the corruption it actually is.
 */
export function isEncryptedEnvelope(data: unknown): data is EncryptedEnvelope {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  if (!('cipherText' in data) || !('iv' in data) || !('tag' in data) || !('type' in data)) {
    return false;
  }
  const { cipherText, iv, tag, type } = data as Record<'cipherText' | 'iv' | 'tag' | 'type', unknown>;
  return (
    typeof cipherText === 'string' &&
    typeof iv === 'string' &&
    typeof tag === 'string' &&
    typeof type === 'string' &&
    permittedAlgorithms.has(type)
  );
}
