import {
  Extensible,
  JSONObject,
  JSONValue
} from "@/types";

import {
  StorageConfig,
} from "./storageService";

/**
 * Payload used to issue a credential
 */
export type IssueCredentialPayload = {
  publish: boolean;      // Whether the credential should be published
  formData: JSONObject;  // Raw form data used to build the credential
}

/**
 * Issuer can be a DID string or a full issuer object.
 */
export type Issuer =
  | ({ id: string } & Extensible)
  | string;

/**
 * Subject(s) the credential is about
 */
export type CredentialSubject = {
  id?: string;
} & Extensible;

/**
 * Status information (e.g., revocation)
 */
export type CredentialStatus = {
  id?: string;
  type: string;
} & Extensible;

/**
 * Schema used to validate the credential
 */
export type CredentialSchema = {
  id: string;
  type: string;
} & Extensible;

/**
 * Proof attached to the credential.
 */
export type Proof = {
  type?: string;
} & Extensible;

/**
 * W3C Verifiable Credential data model
 */
export type W3CVerifiableCredential = {
  "@context": string[];
  type: string[];

  id?: string;

  issuer: Issuer;
  credentialSubject: CredentialSubject[] | CredentialSubject;

  validFrom?: string;
  validUntil?: string;

  credentialStatus: CredentialStatus[] | CredentialStatus;
  credentialSchema: CredentialSchema[] | CredentialSchema;

  proof?: Proof;
} & Extensible;

/**
 * Wrapper for a signed verifiable credential
 */
export type SignedVerifiableCredential = {
  verifiableCredential: W3CVerifiableCredential;
}

export type IssueCredentialConfig = {
  storage: StorageConfig; 
  // TODO: Add type options when we support generic credential types
} & Extensible;

/**
 * Service responsible for issuing verifiable credentials
 */
export interface IVerifiableCredentialService {
  /**
   * Issue and sign a verifiable credential
   */
  issue(config: IssueCredentialConfig, payload: IssueCredentialPayload): Promise<SignedVerifiableCredential>;
}
