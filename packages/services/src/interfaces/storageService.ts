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
 * Service responsible for persisting verifiable credentials
 */
export interface IStorageService {
  /**
   * Stores a signed verifiable credential using the provided storage configuration
   */
  store(
    url: string,
    method: string,
    bucket: string,
    credential: SignedVerifiableCredential,
    headers?: Record<string, string>
  ): Promise<StorageRecord>
}
