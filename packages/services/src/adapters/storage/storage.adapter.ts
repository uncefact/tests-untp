import type { StorageRecord, IStorageService } from './interfaces/storageService';

import type { EnvelopedVerifiableCredential } from './interfaces/verifiableCredentialService';

/**
 * HTTP methods supported for storage operations
 */
export type StorageMethod = 'PUT' | 'POST';

/**
 * Service implementation for storing verifiable credentials
 * Implements the IStorageService interface
 */
export class StorageService implements IStorageService {
  readonly url: string;
  readonly method: StorageMethod;
  readonly headers?: Record<string, string>;
  readonly params?: Record<string, unknown>;

  constructor(url: string, method: StorageMethod, headers?: Record<string, string>, params?: Record<string, unknown>) {
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.params = params;
  }

  /**
   * Stores an enveloped verifiable credential to the configured storage service
   * @param credential - The enveloped verifiable credential to store
   * @returns A promise that resolves to a storage record
   */
  async store(credential: EnvelopedVerifiableCredential): Promise<StorageRecord> {
    const payload = {
      ...this.params,
      data: credential,
    };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    try {
      const response = await fetch(this.url, {
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
