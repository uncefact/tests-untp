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
export type StorageConfig<TParams extends object = {}> = {
  params?: TParams;
  headers?: Record<string, string>;
};

/**
 * Service responsible for persisting verifiable credentials
 */
export interface IStorageService {
  /**
   * Stores a signed verifiable credential using the provided storage configuration
   */
  store(
    credential: SignedVerifiableCredential,
    config?: StorageConfig,
  ): Promise<StorageRecord>
}
