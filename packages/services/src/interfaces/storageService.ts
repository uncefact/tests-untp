import {
  Extensible
} from "@/types";

import {
  SignedVerifiableCredential
} from "./verifiableCredentialService";

/**
 * Result of storing a verifiable credential in external storage
 */
export type StorageResponse = {
  uri: string;
  hash: string;
} & Extensible;

/**
 * Configuration for storing a credential in an external storage service
 */
export type StorageConfig = {
  url: string;
  params: { 
    bucket?: string;
  } & Extensible;
  options: {
    method: 'POST' | 'PUT';
    headers: Record<string, string>;
  } & Extensible;
} & Extensible;

/**
 * Service responsible for persisting verifiable credentials
 */
export interface IStorageService {
  /**
   * Stores a signed verifiable credential using the provided storage configuration
   */
  store(
    config: StorageConfig,
    credential: SignedVerifiableCredential
  ): Promise<StorageResponse>
}
