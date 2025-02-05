export enum VCDMVersion {
  V1 = 'v1',
  V2 = 'v2',
  UNKNOWN = 'unknown',
}

export enum VCProofType {
  ENVELOPING = 'enveloping',
  EMBEDDED = 'embedded',
  UNKNOWN = 'unknown',
}

export const VCDM_CONTEXT_URLS = {
  [VCDMVersion.V1]: 'https://www.w3.org/2018/credentials/v1',
  [VCDMVersion.V2]: 'https://www.w3.org/ns/credentials/v2',
};

// The v1 VCDM schema URL is the only reference I could find online. However, it's having an identity crisis. I've sent an email out to the VC mailing list.
export const VCDM_SCHEMA_URLS = {
  [VCDMVersion.V1]:
    'https://raw.githubusercontent.com/w3c/vc-data-model/cee2fc225ae7c6c47f0bb53e5cbe8e036a3cfe49/schema/verifiable-credential/verifiable-credential-schema.json',
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
}
