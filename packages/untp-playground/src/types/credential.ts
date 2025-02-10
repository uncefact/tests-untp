import { TestCaseStatus, TestCaseStepId } from '../../constants';

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
  id: TestCaseStepId;
  name: string;
  status: TestCaseStatus;
  details?: any;
}

export type { Credential, CredentialType, TestStep, VerificationResult };
