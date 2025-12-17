import {
  Extensible,
  JSONValue
} from "@/types";

import {
  SignedVerifiableCredential
} from "./verifiableCredentialService";

import {
  StorageResponse
} from "./storageService";

/**
 * Result of publishing credential to the identity resolver
 */
export type PublishResponse = {
  enabled: boolean;
  raw: JSONValue;
} & Extensible;

/**
 * Configuration for publishing a credential to the identity resolver
 */
export type IdentityResolverConfig = {
  dlrVerificationPage: string;
  dlrLinkTitle: string;
  dlrAPIKey: string;
  linkRegisterPath: string;
  dlrAPIUrl: string;
} & Extensible;

/**
 * Service for publishing credentials to an identity resolver
 */
export interface IIdentityResolverService {
  /**
   * Publishes a signed credential
   */
  publish(
    config: IdentityResolverConfig, 
    credential: SignedVerifiableCredential, 
    storage: StorageResponse
  ): Promise<PublishResponse>
}
