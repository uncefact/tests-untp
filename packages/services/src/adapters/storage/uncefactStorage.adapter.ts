import type { StorageRecord, IStorageService } from '../../interfaces/storageService';

import type { EnvelopedVerifiableCredential } from '../../interfaces/verifiableCredentialService';

/**
 * Adapter for the UNCEFACT Identity Resolver storage service
 * Implements the IStorageService interface
 */
export class UNCEFACTStorageAdapter implements IStorageService {
  readonly baseURL: string;
  readonly headers: Record<string, string>;
  readonly bucket: string;

  /**
   * Constructs a new UNCEFACTStorageAdapter instance
   * @param baseURL - The base URL of the UNCEFACT Identity Resolver storage API
   * @param headers - HTTP headers to include with requests (must contain X-API-Key)
   * @param bucket - The storage bucket name for storing credentials
   */
  constructor(baseURL: string, headers: Record<string, string>, bucket: string) {
    if (!baseURL) {
      throw new Error("Error creating UNCEFACTStorageAdapter. API URL is required.");
    }

    if (!headers?.['X-API-Key']) {
      throw new Error("Error creating UNCEFACTStorageAdapter. X-API-Key header is required.");
    }

    if (!bucket) {
      throw new Error("Error creating UNCEFACTStorageAdapter. Bucket is required.");
    }

    this.baseURL = baseURL;
    this.headers = headers;
    this.bucket = bucket;
  }

  /**
   * Stores an enveloped verifiable credential to the configured storage service
   * @param credential - The enveloped verifiable credential to store
   * @param encrypt - If true, uses the /credentials endpoint which encrypts the data
   *                  and returns a decryption key. If false, uses /documents for
   *                  unencrypted storage. Defaults to false.
   * @returns A promise that resolves to a storage record
   */
  async store(credential: EnvelopedVerifiableCredential, encrypt = false): Promise<StorageRecord> {
    const endpoint = encrypt ? '/credentials' : '/documents';
    const url = `${this.baseURL}${endpoint}`;

    const payload = {
      bucket: this.bucket,
      data: credential,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const { uri, hash, key } = await response.json();
      
      return {
        uri,
        hash,
        decryptionKey: key,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to store verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to store verifiable credential: Unknown error');
    }
  }
}
