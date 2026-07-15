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

// Exported so isEncryptedEnvelope can check `type` against the same
// allow-list assertPermittedAlgorithm enforces at decrypt time, rather than
// duplicating it — a second, drifting copy is how a shape check and the
// actual algorithm gate quietly disagree.
export const permittedAlgorithms = new Set<string>(Object.values(EncryptionAlgorithm));

export function assertPermittedAlgorithm(algorithm: string): asserts algorithm is EncryptionAlgorithm {
  if (!permittedAlgorithms.has(algorithm)) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
}

/**
 * Decoded byte-length each algorithm's IV and auth tag must have. Used to
 * detect a structurally malformed envelope (right shape, wrong decoded byte
 * count) before attempting to decrypt it: Node's AES-GCM implementation
 * does not reliably reject a wrong-length IV or tag at construction, and a
 * wrong length that is accepted fails later with the identical error a
 * genuinely wrong key produces ("Unsupported state or unable to
 * authenticate data"), so byte length has to be checked up front rather
 * than inferred from whatever decrypt() throws.
 *
 * Values are what this package's own adapter produces, not an external
 * spec: `AesGcmEncryptionAdapter.encrypt` generates a 12-byte IV
 * (`crypto.randomBytes(12)`) and Node's AES-256-GCM `cipher.getAuthTag()`
 * returns a 16-byte tag by default (no `authTagLength` override is set).
 */
export const ALGORITHM_FIELD_LENGTHS: Record<EncryptionAlgorithm, { ivBytes: number; tagBytes: number }> = {
  [EncryptionAlgorithm.AES_256_GCM]: { ivBytes: 12, tagBytes: 16 },
};

export interface IEncryptionService {
  encrypt(plaintext: string, algorithm: EncryptionAlgorithm): EncryptedEnvelope;
  decrypt(envelope: EncryptedEnvelope): string;
}
