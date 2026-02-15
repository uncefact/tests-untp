import { ServiceError } from '../errors.js';

/** Base error for all storage service operations. */
export class StorageError extends ServiceError {}

/** Failed to store a credential to the upstream storage service. */
export class StorageStoreError extends StorageError {
  constructor(httpStatus: number, detail: string) {
    super(`Failed to store credential: HTTP ${httpStatus}: ${detail}`, 'STORAGE_STORE_FAILED', 502, { httpStatus });
  }
}
