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

export const shortCredentialTypes: Record<string, string> = {
  DigitalProductPassport: 'dpp',
  DigitalConformityCredential: 'dcc',
  DigitalTraceabilityEvent: 'dte',
  DigitalFacilityRecord: 'dfr',
  DigitalIdentityAnchor: 'dia',
};
