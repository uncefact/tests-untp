import type { EnvelopedVerifiableCredential } from '../interfaces/verifiableCredentialService.js';

export const STORAGE_SERVICE_TYPE = 'STORAGE' as const;

/**
 * Result of storing a verifiable credential.
 */
export type StorageRecord = {
  /** URI where the credential is stored */
  uri: string;
  /** Hash of the stored credential for integrity verification */
  hash: string;
  /** Decryption key if the credential was stored encrypted */
  decryptionKey?: string;
};

/**
 * Service responsible for persisting verifiable credentials.
 */
export interface IStorageService {
  /**
   * Stores an enveloped verifiable credential.
   * @param credential - The enveloped verifiable credential to store
   * @param encrypt - If true, the credential will be encrypted by the storage service
   *                  and a decryption key will be returned. Defaults to false.
   */
  store(credential: EnvelopedVerifiableCredential, encrypt?: boolean): Promise<StorageRecord>;
}
