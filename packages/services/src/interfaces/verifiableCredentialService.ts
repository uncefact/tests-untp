import type {
  Extensible,
  JSONObject,
  JSONValue,
  NonEmptyArray,
  OneOrMany
} from "@/types";

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
  "@context": string[];
  type: VCType;
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
 * Enveloped Verifiable Credential
 * A credential that has been secured and wrapped in an envelope format (e.g., JWT, JOSE)
 */
export type EnvelopedVerifiableCredential = W3CVerifiableCredential & {
  type: 'EnvelopedVerifiableCredential';
};

/**
 * Decoded Verifiable Credential
 * The unsigned/decoded content of an enveloped credential
 */
export type DecodedVerifiableCredential = Omit<W3CVerifiableCredential, 'proof'> & Extensible;

export type RenderMethod = {
  type: string;
  template: string;
}

/**
 * Input payload used to issue a verifiable credential
 */
export type CredentialPayload = {
  context?: string[];
  type?: VCType;
  issuer?: Issuer;
  credentialSubject: OneOrMany<CredentialSubject>;
} & Extensible;

export type Error = {
  message?: string;
  errorCode?: string;
}

export type VerifyResult = {
  verified: boolean;
  error?: Error;
};

/**
 * Service responsible for issuing verifiable credentials
 */
export interface IVerifiableCredentialService {
  /**
   * Issues a verifiable credential
   */
  sign(
    baseURL: string,
    credentialPayload: CredentialPayload,
    headers?: Record<string, string>
  ): Promise<SignedVerifiableCredential>
}
