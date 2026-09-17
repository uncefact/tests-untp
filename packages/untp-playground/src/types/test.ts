import { TestCaseStatus, TestCaseStepId } from '../../constants';
import type { ArtefactStepFailure } from '../lib/artefactFailure';

export interface VerificationResult {
  success: boolean;
  message: string;
  details?: any;
}

export interface TestStep {
  id: TestCaseStepId;
  name: string;
  status: TestCaseStatus;
  details?: any;
  failure?: ArtefactStepFailure;
}
