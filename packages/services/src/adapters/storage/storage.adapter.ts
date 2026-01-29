import type { StorageRecord, IStorageService } from '../../interfaces/storageService';

import type { EnvelopedVerifiableCredential } from '../../interfaces/verifiableCredentialService';

/**
 * Adapter implementation for storing verifiable credentials
 * Implements the IStorageService interface
 */
export class StorageAdapter implements IStorageService {
  readonly baseURL: string;
  readonly headers: Record<string, string>;
  readonly additionalPayload?: Record<string, unknown>;

  /**
   * Constructs a new StorageAdapter instance
   * @param baseURL - The base URL of the storage API
   * @param headers - HTTP headers to include with requests (must contain X-API-Key)
   * @param additionalPayload - Optional additional data to merge into the request payload
   */
  constructor(baseURL: string, headers: Record<string, string>, additionalPayload?: Record<string, unknown>) {
    if (!baseURL) {
      throw new Error("Error creating StorageAdapter. API URL is required.");
    }

    if (!headers?.['X-API-Key']) {
      throw new Error("Error creating StorageAdapter. X-API-Key header is required.");
    }

    this.baseURL = baseURL;
    this.headers = headers;
    this.additionalPayload = additionalPayload;
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
      ...this.additionalPayload,
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

      return (await response.json()) as StorageRecord;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to store verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to store verifiable credential: Unknown error');
    }
  }
}
