type CredentialType =
  | 'DigitalProductPassport'
  | 'DigitalConformityCredential'
  | 'DigitalFacilityRecord'
  | 'DigitalIdentityAnchor'
  | 'DigitalTraceabilityEvent';

interface VerificationResult {
  success: boolean;
  message: string;
  details?: any;
}

interface Credential {
  '@context': string[];
  type: string[];
  id?: string;
  [key: string]: any;
}

interface TestStep {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'success' | 'failure' | 'missing';
  details?: any;
}

export type { Credential, CredentialType, TestStep, VerificationResult };
