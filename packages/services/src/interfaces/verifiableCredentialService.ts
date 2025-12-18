import type { 
  Extensible,
  JSONObject,
  JSONValue,
  NonEmptyArray,
  OneOrMany
} from "@/types";

export const contextDefault = 'https://www.w3.org/ns/credentials/v2';
export const typeDefault = 'VerifiableCredential';

/** JSON-LD Context value allowed by the schema */
export type JsonLdContext = string | ({ [key: string]: JSONValue } & Extensible);

/** "type" fields can be a string or a non-empty array of strings */
export type VCType = string | NonEmptyArray<string>;

/** Issuer can be a DID/URL string or an object with an id */
export type Issuer = string | ({ id: string } & Extensible);

/**
 * Subject(s) the credential is about.
 */
export type CredentialSubject = { id?: string } & Extensible;

/** Status info */
export type CredentialStatus = { type: VCType; id?: string } & Extensible;

/** Credential schema objects */
export type CredentialSchema = { id: string; type: VCType } & Extensible;

export type RefreshService = { id: string; type: VCType } & Extensible;
export type TermsOfUse = { type: VCType; id?: string } & Extensible;
export type Evidence = { type: VCType; id?: string } & Extensible;

export type VerificationMethodObject = {
  id: string;
  type: string;
  controller: string;
} & Extensible;

export type VerificationMethod = string | NonEmptyArray<VerificationMethodObject>;

export type Proof = {
  type: VCType;
  proofPurpose: string;
  verificationMethod: VerificationMethod;

  created?: string;
  domain?: string;
  challenge?: string;
  proofValue?: string;
} & Extensible;

/**
 * W3C VC v2
 */
export type W3CVerifiableCredential = {
  "@context": NonEmptyArray<JsonLdContext> & {
    0: contextDefault;
  };

  type: typeDefault | [typeDefault, ...string[]];

  id?: string;
  name?: string;
  description?: string;

  issuer: Issuer;

  credentialSubject: OneOrMany<CredentialSubject>;

  validFrom?: string;
  validUntil?: string;

  credentialStatus?: OneOrMany<CredentialStatus>;
  credentialSchema?: OneOrMany<CredentialSchema>;

  refreshService?: OneOrMany<RefreshService>;
  termsOfUse?: OneOrMany<TermsOfUse>;
  evidence?: OneOrMany<Evidence>;

  proof?: OneOrMany<Proof>;
} & Extensible;

/** Wrapper for a signed verifiable credential */
export type SignedVerifiableCredential = {
  verifiableCredential: W3CVerifiableCredential;
};

/**
 * Configuration for issuing a verifiable credential
 */
export type IssueConfig = {
  context: NonEmptyArray<JsonLdContext> & {
    0: contextDefault;
  };
  type: VCType;
  url: string;
  issuer: Issuer;
  renderMethod?: RenderMethod[];
  validFrom?: string;
  validUntil?: string;
  headers?: Record<string, string>;
}

export type RenderMethod = {
  type: string;
  template: string;
}

/**
 * Input payload used to issue a verifiable credential
 */
export type CredentialPayload = {
  formData: JSONObject;
  publish?: boolean;
};

/**
 * Service responsible for issuing verifiable credentials
 */
export interface IVerifiableCredentialService {
/**
   * Issues a verifiable credential
   */
  sign(
    config: IssueConfig, 
    payload: CredentialPayload
  ): Promise<SignedVerifiableCredential>
}
