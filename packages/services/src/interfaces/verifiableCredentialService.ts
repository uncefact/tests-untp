import type {
  Extensible,
  JSONObject,
  JSONValue,
  NonEmptyArray,
  OneOrMany
} from "@/types";

/** "type" fields can be a string or a non-empty array of strings */
export type VCType = string | NonEmptyArray<string>;

/** Also known as identity for the issuer */
export type IssuerAlsoKnownAs = {
  id: string;
  name: string;
  registeredId?: string;
};

/**
 * The issuer party (person or organisation) of a verifiable credential.
 */
export type Issuer = {
  id: string;
  name: string;
  type?: NonEmptyArray<string>;
  issuerAlsoKnownAs?: IssuerAlsoKnownAs[];
};

/**
 * Subject(s) the credential is about.
 */
export type CredentialSubject = { id?: string } & Extensible;

/** 
 * Status info 
 * https://www.w3.org/TR/vc-bitstring-status-list/#bitstringstatuslistentry
 */
export type CredentialStatus = { 
  type: "BitstringStatusListEntry"; 
  statusPurpose: "revocation";
  statusListIndex: string;
  statusListCredential: string;
  id?: string;
  statusMessage?: Array<{ status: string; message: string }>;
  statusSize?: number;
  statusReference?: OneOrMany<string>;
};

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
  credentialStatus: OneOrMany<CredentialStatus>;
  validFrom?: string;
  validUntil?: string;
  credentialSchema?: OneOrMany<CredentialSchema>;
  refreshService?: OneOrMany<RefreshService>;
  termsOfUse?: OneOrMany<TermsOfUse>;
  evidence?: OneOrMany<Evidence>;
  proof?: OneOrMany<Proof>;
} & Extensible;

/** Wrapper for a signed verifiable credential */
export type SignedVerifiableCredential = {
  "@context": string[];
  type: "VerifiablePresentation";
  verifiableCredential: EnvelopedVerifiableCredential;
};

/**
 * Enveloped Verifiable Credential
 */
export type EnvelopedVerifiableCredential = {
  "@context": string[];
  id: string;
  type: "EnvelopedVerifiableCredential";
};

/**
 * Decoded Verifiable Credential
 * The unsigned/decoded content of an enveloped credential
 */
export type DecodedVerifiableCredential = Omit<W3CVerifiableCredential, 'proof'> & Extensible;

export type RenderMethod = {
  type: string;
  template: string;
} & Extensible;

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
  sign(payload: CredentialPayload): Promise<EnvelopedVerifiableCredential>
  verify(credential: EnvelopedVerifiableCredential): Promise<VerifyResult>
  decode(credential: EnvelopedVerifiableCredential): Promise<DecodedVerifiableCredential>
}
