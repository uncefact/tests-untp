import {
  Extensible
} from "@/types";

import {
  SignedVerifiableCredential
} from "./verifiableCredentialService";

/**
 * Result of storing a verifiable credential
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
    credential: SignedVerifiableCredential,
  ): Promise<StorageRecord>
}
