import type { StorageRecord, IStorageService } from '../../interfaces/storageService';

import type { EnvelopedVerifiableCredential } from '../../interfaces/verifiableCredentialService';

/**
 * HTTP methods supported for storage operations
 */
export type StorageMethod = 'POST';

/**
 * Service implementation for storing verifiable credentials
 * Implements the IStorageService interface
 */
export class StorageService implements IStorageService {
  readonly baseURL: string;
  readonly method: StorageMethod;
  readonly headers?: Record<string, string>;
  readonly params?: Record<string, unknown>;

  constructor(baseURL: string, method: StorageMethod, headers?: Record<string, string>, params?: Record<string, unknown>) {
    if (!baseURL) {
      throw new Error("Error creating StorageService. API URL is required.");
    }

    if (!method) {
      throw new Error("Error creating StorageService. method is required.");
    }

    this.baseURL = baseURL;
    this.method = method;
    this.headers = headers;
    this.params = params;
  }

  /**
   * Stores an enveloped verifiable credential to the configured storage service
   * @param credential - The enveloped verifiable credential to store
   * @param encrypt - If true, uses the /credentials endpoint which encrypts the data
   *                  and returns a decryption key. If false, uses /documents for
   *                  unencrypted storage. Defaults to false.
   * @returns A promise that resolves to a storage record
   */
  async store(credential: EnvelopedVerifiableCredential, encrypt: boolean = false): Promise<StorageRecord> {
    const endpoint = encrypt ? '/credentials' : '/documents';
    const url = `${this.baseURL}${endpoint}`;

    const payload = {
      ...this.params,
      data: credential,
    };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    try {
      const response = await fetch(url, {
        method: this.method,
        headers: requestHeaders,
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
