import type { EncryptedEnvelope } from './encryption.interface.js';

/**
 * Checks whether the given value looks like an encrypted envelope
 * (has cipherText, iv, tag, and type fields).
 */
export function isEncryptedEnvelope(data: unknown): data is EncryptedEnvelope {
  return (
    typeof data === 'object' && data !== null && 'cipherText' in data && 'iv' in data && 'tag' in data && 'type' in data
  );
}
