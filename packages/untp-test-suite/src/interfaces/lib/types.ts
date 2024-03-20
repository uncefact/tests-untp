import { TestSuiteResult } from '../../core/types/index.js';

export interface TestSuiteHandler {
  (credentialPath: string): Promise<TestSuiteResult>;
}