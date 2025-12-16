<<<<<<< HEAD
import type { NonEmptyArray, OneOrMany } from '@/types';

/**
 * UNTP VCDM Profile Types
 *
 * These types model the UN Transparency Protocol's Verifiable Credentials profile,
 * which is a constrained subset of the W3C VC Data Model v2.0.
 *
 * Key constraints:
 * - Uses enveloping proof mechanism (JOSE/JWT) - NOT embedded proofs
 * - Uses BitstringStatusList for revocation - no other status mechanisms
 * - Does NOT use Verifiable Presentations
 *
 * Extension support:
 * - Core UNTP types (CredentialIssuer, CredentialStatus, etc.) are strict
 * - CredentialSubject and the VC itself allow additional properties for extensions
 * - Our system requires only UNTP core fields to function; extensions are passed through
 *
 * @see https://untp.unece.org/docs/specification/VerifiableCredentials
 * @see https://www.w3.org/TR/vc-data-model-2.0/
 * @see https://www.w3.org/TR/vc-jose-cose/
 */

/**
 * W3C Verifiable Credentials v2 context URI.
 * This MUST be the first element in any @context array.
 */
export const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

/**
 * JSON-LD @context for UNTP Verifiable Credentials.
 * First element MUST be the W3C VC v2 context, followed by UNTP-specific contexts.
 */
export type VCContext = [typeof VC_CONTEXT_V2, ...string[]];

/**
 * Verifiable Credential type constant.
 * This MUST be included in the type array.
 */
export const VC_TYPE = 'VerifiableCredential';

/**
 * Type array for UNTP Verifiable Credentials.
 * First element MUST be "VerifiableCredential", followed by credential-specific types (e.g., "DigitalProductPassport").
 */
export type VCType = [typeof VC_TYPE, ...string[]];

/**
 * W3C Decentralized Identifier (DID) for UNTP.
 *
 * UNTP restricts DID methods to:
 * - did:web (MUST implement)
 * - did:webvh (RECOMMENDED for verifiable history)
 *
 * @see https://untp.unece.org/docs/specification/DIDMethods
 * @see https://www.w3.org/TR/did-core/
 */
export type DID = `did:web:${string}` | `did:webvh:${string}`;

/**
 * Identifier scheme describing the registry or system that issued an identifier.
 */
export type IdentifierScheme = {
  type: NonEmptyArray<string>;
  id: string;
  name: string;
};

/**
 * Alternative identity for the issuer, typically a business registration.
 */
export type IssuerAlsoKnownAs = {
  id: string;
  name: string;
  registeredId?: string;
  idScheme?: IdentifierScheme;
};

/**
 * The issuer of a UNTP verifiable credential.
 * The `id` property MUST be a W3C DID (did:web or did:webvh recommended).
 */
export type CredentialIssuer = {
  type: NonEmptyArray<string>;
  id: DID;
  name: string;
  issuerAlsoKnownAs?: IssuerAlsoKnownAs[];
};

/**
 * The subject of a credential - what the credential is about.
 * Structure varies by credential type (Product, Facility, ConformityAttestation, etc.)
 */
export type CredentialSubject = {
  type: NonEmptyArray<string>;
  id?: string;
  [key: string]: unknown;
};

/**
 * Credential status using W3C Bitstring Status List.
 * UNTP uses this exclusively for revocation checking.
 *
 * @see https://www.w3.org/TR/vc-bitstring-status-list/#bitstringstatuslistentry
 */
export type CredentialStatus = {
  id: string;
  type: 'BitstringStatusListEntry';
  statusPurpose: 'revocation';
  statusListIndex: number;
  statusListCredential: string;
};

/**
 * Render method type identifiers supported by UNTP.
 */
export type RenderMethodType = 'RenderTemplate2024' | 'WebRenderingTemplate2022';

/**
 * Base properties for RenderTemplate2024.
 */
type RenderTemplate2024Base = {
  /** Render method type identifier (uses @type in JSON-LD) */
  type: 'RenderTemplate2024';
  /** Multibase-encoded digest for template integrity verification */
  digestMultibase: string;
  /** Human-readable display name for template selection */
  name?: string;
  /** CSS media query for responsive rendering */
  mediaQuery?: string;
  /** MIME type (e.g., "text/html") */
  mediaType?: string;
};
=======
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
>>>>>>> 25065549 (fix: follow w3c v2 spec)

/**
 * RenderTemplate2024 with inline template.
 */
type RenderTemplate2024Inline = RenderTemplate2024Base & {
  /** Inline Handlebars/Mustache template */
  template: string;
  url?: never;
};

<<<<<<< HEAD
/**
 * RenderTemplate2024 with remote URL.
 */
type RenderTemplate2024Remote = RenderTemplate2024Base & {
  /** URL for remotely hosted template */
  url: string;
  template?: never;
};
=======
  issuer: Issuer;

  credentialSubject: OneOrMany<CredentialSubject>;
>>>>>>> 25065549 (fix: follow w3c v2 spec)

/**
 * RenderTemplate2024 - W3C VC Render Method with full feature support.
 * Requires either `template` (inline) or `url` (remote), plus `digestMultibase` for integrity.
 *
 * @see https://w3c.github.io/vc-render-method/
 */
export type RenderTemplate2024 = RenderTemplate2024Inline | RenderTemplate2024Remote;

/**
 * WebRenderingTemplate2022 - Legacy render method with inline template only.
 */
export type WebRenderingTemplate2022 = {
  /** Render method type identifier (uses @type in JSON-LD) */
  type: 'WebRenderingTemplate2022';
  /** Inline Handlebars template */
  template: string;
  /** Human-readable display name */
  name?: string;
};

/**
 * Render method for human-readable credential display.
 * UNTP supports RenderTemplate2024 and WebRenderingTemplate2022.
 */
export type RenderMethod = RenderTemplate2024 | WebRenderingTemplate2022;

/**
 * A UNTP Verifiable Credential (decoded/unsigned form).
 *
 * This represents the credential content inside the JWT envelope.
 * It is a constrained profile of W3C VC Data Model v2.0.
 *
 * Note: credentialSubject can be a single object (DPP, DFR, DCC) or an array (DTE).
 *
 * Extension support: Industry extensions may add additional properties beyond those
 * defined here. These are passed through transparently - our system only requires
 * the UNTP core fields defined in this type to function.
 */
export type UNTPVerifiableCredential = {
  /** JSON-LD context, first element MUST be "https://www.w3.org/ns/credentials/v2" */
  '@context': VCContext;
  /** Credential types, first element MUST be "VerifiableCredential" */
  type: VCType;
  /** Unique identifier for this credential (URI) */
  id: string;
  /** The party that issued this credential */
  issuer: CredentialIssuer;
  /** The subject(s) of the credential - single object for DPP/DFR/DCC, array for DTE */
  credentialSubject: OneOrMany<CredentialSubject>;
  /** Status information for revocation checking */
  credentialStatus: CredentialStatus;
  /** ISO 8601 datetime when the credential becomes valid */
  validFrom?: string;
  /** ISO 8601 datetime when the credential expires */
  validUntil?: string;
<<<<<<< HEAD
  /** Render methods for human-readable credential display (SHOULD per UNTP spec) */
  renderMethod?: NonEmptyArray<RenderMethod>;
};

/**
 * Enveloped Verifiable Credential (signed/secured form).
 *
 * This is the JWT-wrapped credential returned by the signing service.
 * The actual credential content is encoded in the `id` property as a data URI.
 *
 * Format: data:application/vc+jwt,<base64url-encoded-jwt>
 *
 * @see https://www.w3.org/TR/vc-jose-cose/
 */
export type EnvelopedVerifiableCredential = {
  /** JSON-LD context for the envelope, first element MUST be "https://www.w3.org/ns/credentials/v2" */
  '@context': VCContext;
  /** Data URI containing the JWT: "data:application/vc+jwt,<jwt>" */
  id: string;
  /** Type identifier for enveloped credentials */
  type: 'EnvelopedVerifiableCredential';
};

/**
 * Input payload for issuing a credential.
 * The service will add defaults for validFrom and credentialStatus.
 *
 * Extension support: Additional properties beyond those defined here will be
 * passed through to the issued credential.
 */
export type CredentialPayload = {
  /** JSON-LD context, first element MUST be "https://www.w3.org/ns/credentials/v2" */
  '@context': VCContext;
  /** Credential types, first element MUST be "VerifiableCredential" */
  type: VCType;
  /** Issuer information */
  issuer: CredentialIssuer;
  /** The subject(s) of the credential - single object for DPP/DFR/DCC, array for DTE */
  credentialSubject: OneOrMany<CredentialSubject>;
  /** Optional validity end date */
  validUntil?: string;
  /** Optional render methods */
  renderMethod?: RenderMethod[];
};

/**
 * Verification error codes.
 */
export enum VerificationErrorCode {
  /** Credential has been revoked (credentialStatus check failed) */
  Status = 'status',
  /** Signature verification failed (JWT/proof invalid) */
  Integrity = 'integrity',
  /** Credential is not yet valid or has expired (validFrom/validUntil) */
  Temporal = 'temporal',
}

/**
 * Error information from verification.
 */
export type VerificationError = {
  type: VerificationErrorCode;
  message: string;
};

/**
 * Result of verifying a credential.
 */
export type VerifyResult = {
  verified: boolean;
  error?: VerificationError;
};

/**
 * Service responsible for issuing and verifying UNTP verifiable credentials.
 *
 * Implementations use enveloping proofs (JOSE/JWT) as required by the UNTP VCDM profile.
 */
export interface IVerifiableCredentialService {
  /**
   * Signs a credential payload and returns an enveloped (JWT-wrapped) credential.
   */
  sign(payload: CredentialPayload): Promise<EnvelopedVerifiableCredential>;

  /**
   * Verifies an enveloped credential's signature and status.
   */
  verify(credential: EnvelopedVerifiableCredential): Promise<VerifyResult>;

  /**
   * Decodes an enveloped credential to extract the unsigned credential content.
   */
  decode(credential: EnvelopedVerifiableCredential): Promise<UNTPVerifiableCredential>;
}
=======

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
>>>>>>> 25065549 (fix: follow w3c v2 spec)
