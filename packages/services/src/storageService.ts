import type { StorageRecord, IStorageService } from './interfaces/storageService';

import type { EnvelopedVerifiableCredential } from './interfaces/verifiableCredentialService';

import { publicAPI } from './utils/httpService.js';

/**
 * HTTP methods supported for storage operations
 */
export type StorageMethod = 'PUT' | 'POST';

/**
 * Config for storage services.
 * Each implementation validates and uses the fields it requires.
 */
export type StorageServiceConfig = Record<string, unknown>;

/**
 * Service implementation for storing verifiable credentials
 * Implements the IStorageService interface
 */
export class StorageService implements IStorageService {
  private readonly config: StorageServiceConfig;

  constructor(config: StorageServiceConfig) {
    this.validateConfig(config);
    this.config = config;
  }

  private validateConfig(config: StorageServiceConfig): void {
    if (!config.url || typeof config.url !== 'string') {
      throw new Error('Storage config error: url is required and must be a string');
    }

    if (!config.method || (config.method !== 'PUT' && config.method !== 'POST')) {
      throw new Error("Storage config error: method is required and must be 'PUT' or 'POST'");
    }

    if (config.headers !== undefined && (typeof config.headers !== 'object' || config.headers === null)) {
      throw new Error('Storage config error: headers must be an object');
    }
  }

  /**
   * Stores an enveloped verifiable credential to the configured storage service
   * @param credential - The enveloped verifiable credential to store
   * @returns A promise that resolves to a storage record
   */
  async store(credential: EnvelopedVerifiableCredential): Promise<StorageRecord> {
    const { url, method, headers, ...params } = this.config;

    const payload = {
      ...params,
      data: credential,
    };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((headers as Record<string, string>) ?? {}),
    };

    try {
      let result: StorageRecord;
      switch (method) {
        case 'PUT':
          result = await publicAPI.put<StorageRecord>(url, payload, requestHeaders);
          break;
        case 'POST':
          result = await publicAPI.post<StorageRecord>(url, payload, requestHeaders);
          break;
        default:
          throw new Error(`Failed to store verifiable credential: Unsupported method`);
      }

      return result;
    } catch (error) {
      console.error(error);
      if (error instanceof Error) {
        throw new Error(`Failed to store verifiable credential: ${error.message}`);
      }
      throw new Error('Failed to store verifiable credential: Unknown error');
    }
  }
}
