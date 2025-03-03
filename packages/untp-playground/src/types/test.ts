import { TestCaseStatus, TestCaseStepId } from '../../constants';

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
}
