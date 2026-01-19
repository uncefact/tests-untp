import { EnvelopedVerifiableCredential } from './verifiableCredentialService';
import { EnvelopedVerifiableCredential } from './verifiableCredentialService';

/**
 * Result of storing a verifiable credential.
 */
export type StorageRecord = {
  /** URI where the credential is stored */
  uri: string;
  /** Hash of the stored credential for integrity verification (i.e. given a url, has the credential been swapped out?) */
  hash: string;
  /** Decryption key if the credential was stored encrypted (public data is public, private data is encrypted and the key is used to decrypt it)*/
  decryptionKey?: string;
};

/**
 * Service responsible for persisting verifiable credentials.
 */
export interface IStorageService {
  readonly baseURL: string;
  readonly defaultHeaders: Record<string, string>;

  /**
   * Stores an enveloped verifiable credential.
   */
  store(credential: EnvelopedVerifiableCredential): Promise<StorageRecord>;
}
