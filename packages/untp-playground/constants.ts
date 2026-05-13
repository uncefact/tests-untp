export enum ArtefactKind {
  CREDENTIAL = 'credential',
  SCHEME = 'scheme',
}

export enum SchemeType {
  CONFORMITY_SCHEME = 'ConformityScheme',
}

export enum CredentialType {
  DIGITAL_PRODUCT_PASSPORT = 'DigitalProductPassport',
  DIGITAL_CONFORMITY_CREDENTIAL = 'DigitalConformityCredential',
  DIGITAL_FACILITY_RECORD = 'DigitalFacilityRecord',
  DIGITAL_IDENTITY_ANCHOR = 'DigitalIdentityAnchor',
  DIGITAL_TRACEABILITY_EVENT = 'DigitalTraceabilityEvent',
  UNKNOWN = 'Unknown',
}

export const permittedCredentialTypes = [
  CredentialType.DIGITAL_PRODUCT_PASSPORT,
  CredentialType.DIGITAL_CONFORMITY_CREDENTIAL,
  CredentialType.DIGITAL_FACILITY_RECORD,
  CredentialType.DIGITAL_IDENTITY_ANCHOR,
  CredentialType.DIGITAL_TRACEABILITY_EVENT,
];

export enum VCDMVersion {
  V1 = 'v1',
  V2 = 'v2',
  UNKNOWN = 'unknown',
}

export const permittedVcdmVersions = [VCDMVersion.V2];

export enum VCProofType {
  ENVELOPING = 'enveloping',
  EMBEDDED = 'embedded',
  UNKNOWN = 'unknown',
}

export const VCDM_CONTEXT_URLS = {
  [VCDMVersion.V1]: 'https://www.w3.org/2018/credentials/v1',
  [VCDMVersion.V2]: 'https://www.w3.org/ns/credentials/v2',
};

export const permittedVcdmContextUrls = [VCDM_CONTEXT_URLS[VCDMVersion.V2]];

export const VCDM_SCHEMA_URLS = {
  [VCDMVersion.V2]:
    'https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json',
};

// Domains used in UNTP credential @context URIs. v0.7.0 introduced the
// `vocabulary.uncefact.org` domain; earlier versions use `test.uncefact.org`.
export const UNTP_CONTEXT_DOMAINS = ['vocabulary.uncefact.org', 'test.uncefact.org'] as const;

// Short names (URL segment) for each UNTP core credential type.
export const UNTP_SHORT_CREDENTIAL_TYPES: Record<string, string> = {
  DigitalProductPassport: 'dpp',
  DigitalConformityCredential: 'dcc',
  DigitalTraceabilityEvent: 'dte',
  DigitalFacilityRecord: 'dfr',
  DigitalIdentityAnchor: 'dia',
  ConformityScheme: 'cvc',
};

// Schema filename (without `.json`) for each UNTP core credential type. Applies
// to v0.7.0 and above — most types match their credential type name verbatim,
// but DCC was renamed from `DigitalConformityCredential` to `ConformityCredential`.
export const UNTP_CORE_SCHEMA_FILENAMES: Record<string, string> = {
  DigitalProductPassport: 'DigitalProductPassport',
  DigitalConformityCredential: 'ConformityCredential',
  DigitalTraceabilityEvent: 'DigitalTraceabilityEvent',
  DigitalFacilityRecord: 'DigitalFacilityRecord',
  DigitalIdentityAnchor: 'DigitalIdentityAnchor',
  ConformityScheme: 'ConformityScheme',
};

export enum TestCaseStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in-progress',
  SUCCESS = 'success',
  WARNING = 'warning',
  FAILURE = 'failure',
}

export enum TestCaseStepId {
  PROOF_TYPE = 'proof-type',
  VCDM_VERSION = 'vcdm-version',
  VCDM_SCHEMA_VALIDATION = 'vcdm-schema-validation',
  VERIFICATION = 'verification',
  UNTP_SCHEMA_VALIDATION = 'untp-schema-validation',
  EXTENSION_SCHEMA_VALIDATION = 'extension-schema-validation',
  CONTEXT_VALIDATION = 'context',
  SCHEME_VERSION_DETECTION = 'scheme-version-detection',
  SCHEME_SCHEMA_VALIDATION = 'scheme-schema-validation',
}

const commonContextUrls = [
  'https://www.w3.org/ns/credentials/v2',
  'https://test.uncefact.org/vocabulary/untp/{type}/{version}/',
];

export const allowedContextValue = {
  '@context': commonContextUrls,
};

export const allowedExtensionValue = {
  '@context': [...commonContextUrls, 'https://{extension.domain}/{type}/{version}/'],
};

// Next.js inlines `NEXT_PUBLIC_*` at build time, so this constant captures
// the deploy-time base path (e.g. `/test-untp-playground`) once and lets
// every client-side `/api/*` caller prefix it consistently. The fallback
// empty string keeps local dev (where the var is unset) working.
export const API_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
