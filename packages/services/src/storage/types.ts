import type { EnvelopedVerifiableCredential } from '../verifiable-credential/types.js';

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
  /** Storage resource identifier */
  externalId: string;
  /** The bucket where content was stored */
  bucket?: string;
  /** The content type used when storing */
  mimeType: string;
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

  /**
   * Stores binary or text content via multipart upload.
   * @param content - The content to store (as a string)
   * @param filename - The filename to use in the multipart upload
   * @param contentType - The MIME type of the content (e.g. 'text/html')
   * @param encrypt - If true, the content will be encrypted by the storage service
   *                  and a decryption key will be returned. Defaults to false.
   */
  storeBinary(content: string, filename: string, contentType: string, encrypt?: boolean): Promise<StorageRecord>;

  /**
   * Deletes content by its storage resource identifier.
   * @param externalId - The storage resource identifier of the content to delete
   * @param bucket - Optional bucket the content resides in
   */
  delete(externalId: string, bucket?: string): Promise<void>;
}
