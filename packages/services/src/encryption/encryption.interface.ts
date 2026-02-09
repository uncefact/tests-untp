export enum EncryptionAlgorithm {
  AES_256_GCM = 'aes-256-gcm',
}

/**
 * Encrypted data envelope.
 *
 * This shape is designed for symmetric AEAD algorithms (AES-256-GCM, ChaCha20-Poly1305, etc.)
 * which share the concepts of IV/nonce and authentication tag. If a fundamentally different
 * algorithm family is introduced (e.g. asymmetric or non-AEAD), this interface may need
 * extending or generalising to accommodate different field requirements.
 */
export interface EncryptedEnvelope {
  /** Base64-encoded ciphertext. */
  cipherText: string;
  /** Base64-encoded initialisation vector / nonce. */
  iv: string;
  /** Base64-encoded authentication tag. */
  tag: string;
  /** Encryption algorithm used. */
  type: EncryptionAlgorithm;
}

const permittedAlgorithms = new Set<string>(Object.values(EncryptionAlgorithm));

export function assertPermittedAlgorithm(algorithm: string): asserts algorithm is EncryptionAlgorithm {
  if (!permittedAlgorithms.has(algorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
}

export interface IEncryptionService {
  encrypt(plaintext: string, algorithm: EncryptionAlgorithm): EncryptedEnvelope;
  decrypt(envelope: EncryptedEnvelope): string;
}
