import {
  Extensible,
  JSONValue
} from "@/types";

import {
  SignedVerifiableCredential
} from "./verifiableCredentialService";

import {
  StorageRecord
} from "./storageService";

/**
 * Result of publishing credential to the identity resolver
 */
export type PublishResponse = {
  enabled: boolean;
  raw: JSONValue;
};

/**
 * Service for publishing credentials to an identity resolver
 */
export interface IIdentityResolverService {
  /**
   * Publishes a signed credential
   */
  publish(
    dlrVerificationPage: string,
    dlrLinkTitle: string,
    dlrAPIKey: string,
    linkRegisterPath: string,
    dlrAPIUrl: string,
    credential: SignedVerifiableCredential, 
    storage: StorageRecord
  ): Promise<PublishResponse>
}
