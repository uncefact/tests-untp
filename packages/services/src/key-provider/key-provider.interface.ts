/**
 * Generates fresh data encryption keys (DEKs) for envelope encryption.
 *
 * Each stored object receives its own key. The plaintext form is used to encrypt,
 * while the encrypted form and key identifier are persisted alongside the ciphertext
 * for later decryption.
 */
export interface IKeyGenerator {
  /** Generate a fresh data encryption key, optionally wrapped by the given master key. */
  generateKey(masterKeyId?: string): Promise<{ keyId: string; plaintextKey: string; encryptedKey: string }>;
}

/**
 * Retrieves encryption keys by identifier.
 *
 * Used for static key retrieval, e.g. fetching the key used to encrypt sensitive
 * service configuration before persisting to the database.
 */
export interface IKeyStore {
  /** Retrieve an encryption key by its identifier. */
  getKey(keyId: string): Promise<string>;
}
