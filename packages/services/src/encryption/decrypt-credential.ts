import { AesGcmEncryptionAdapter } from './adapters/aes-gcm/aes-gcm.adapter.js';
import { assertPermittedAlgorithm } from './encryption.interface.js';
import type { EncryptionAlgorithm } from './encryption.interface.js';
import { createLogger } from '../logging/factory.js';

const logger = createLogger().child({ module: 'decrypt-credential' });

export interface DecryptionParams {
  cipherText: string;
  key: string;
  iv: string;
  tag: string;
  type: EncryptionAlgorithm;
}

/**
 * Backwards-compatible decryption function.
 *
 * Wraps the AesGcmEncryptionAdapter for callers that pass individual fields
 * rather than constructing an adapter instance. Prefer using IEncryptionService
 * directly in new code.
 */
export const decryptCredential = ({ cipherText, key, iv, tag, type }: DecryptionParams): string =>
  Buffer.from(decryptCredentialToBytes({ cipherText, key, iv, tag, type })).toString('utf8');

/**
 * The same decryption, returning the plaintext bytes. A caller that digests
 * or re-stores what it decrypted takes these rather than {@link
 * decryptCredential}, whose UTF-8 decode is lossy for a payload that is not
 * valid UTF-8 and would change the bytes an integrity digest is taken over.
 */
export const decryptCredentialToBytes = ({ cipherText, key, iv, tag, type }: DecryptionParams): Uint8Array => {
  assertPermittedAlgorithm(type);
  const adapter = new AesGcmEncryptionAdapter(key, logger);
  return adapter.decryptToBytes({ cipherText, iv, tag, type });
};
