import type { 
  Extensible,
  JSONValue,
  NonEmptyArray,
  OneOrMany
} from "@/types";

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
    0: "https://www.w3.org/ns/credentials/v2";
  };

  type: "VerifiableCredential" | ["VerifiableCredential", ...string[]];

  id?: string;

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
