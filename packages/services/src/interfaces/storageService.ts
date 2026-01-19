import {
  Extensible
} from "@/types";

import {
  SignedVerifiableCredential
} from "./verifiableCredentialService";

/**
 * Result of storing a verifiable credential in external storage
 */
export type StorageRecord = {
  uri: string;
  hash: string;
  decryptionKey?: string;
};

/**
 * Configuration for storing a credential in an external storage service
 */
export type StorageConfig<TParams extends object = Record<string, never>> = {
  params?: TParams;
  headers?: Record<string, string>;
};

/**
 * Service responsible for persisting verifiable credentials
 */
export interface IStorageService {
  readonly baseURL: string;
  readonly defaultHeaders: Record<string, string>;

  /**
   * Stores a signed verifiable credential using the provided storage configuration
   */
  store(
    credential: SignedVerifiableCredential,
    config?: StorageConfig,
  ): Promise<StorageRecord>
}
