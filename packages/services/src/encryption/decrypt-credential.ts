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
export const decryptCredential = ({ cipherText, key, iv, tag, type }: DecryptionParams): string => {
  assertPermittedAlgorithm(type);
  const adapter = new AesGcmEncryptionAdapter(key, logger);
  return adapter.decrypt({ cipherText, iv, tag, type });
};
