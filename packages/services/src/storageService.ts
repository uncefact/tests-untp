import type {
  SignedVerifiableCredential,
  StorageResponse,
  IStorageService
} from './interfaces/storageService';

import { publicAPI } from './utils/httpService.js';

/**
 * HTTP methods supported for storage operations
 */
export type StorageMethod = 'PUT' | 'POST';

/**
 * Service implementation for storing verifiable credentials
 * Implements the IStorageService interface
 */
export class StorageService implements IStorageService {
  /**
   * Stores a verifiable credential to the specified storage service
   * @param url - The storage API endpoint URL
   * @param method - HTTP method to use (PUT or POST)
   * @param bucket - The storage bucket name
   * @param credential - The signed verifiable credential to store
   * @param headers - Optional additional HTTP headers
   * @returns A promise that resolves to a storage response
   */ 
  async store(
    url: string,
    method: StorageMethod,
    bucket: string,
    credential: SignedVerifiableCredential,
    headers?: Record<string, string>
  ): Promise<StorageResponse> {
    if (!url) {
      throw new Error("Error storing VC. API URL is required.");
    }

    if (!bucket) {
      throw new Error("Error storing VC. Bucket name is required.");
    }

    const payload: { bucket: string; data: SignedVerifiableCredential } = {
      bucket,
      data: credential
    };

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    };

    try {
      let result: StorageResponse;
      switch (method) {
        case 'PUT':
          result = await publicAPI.put<StorageResponse>(url, payload, requestHeaders);
        break;
        case 'POST':
          result = await publicAPI.post<StorageResponse>(url, payload, requestHeaders);
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
