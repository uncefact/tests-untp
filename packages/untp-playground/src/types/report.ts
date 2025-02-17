import { TestCaseStatus } from '../../constants';
import { EXTENSION_VERSIONS } from '../lib/schemaValidation';
import { Credential } from './credential';
import { TestStep } from './test';
import { PermittedCredentialType } from './untp';

export interface TestReport {
  date: string;
  testSuite: {
    runner: string;
    version: string;
  };
  implementation: {
    name: string;
  };
  pass: boolean;
  results: TestReportResult[];
}

export type TestReportStatus = Extract<
  TestCaseStatus,
  TestCaseStatus.SUCCESS | TestCaseStatus.WARNING | TestCaseStatus.FAILURE
>;

export interface TestReportStep extends Omit<TestStep, 'status'> {
  status: TestReportStatus;
}

export interface TestReportResult {
  status: TestReportStatus;
  credential: Credential;
  core: {
    type: PermittedCredentialType;
    version: string;
    steps: TestReportStep[];
  };
  extension?: {
    type: keyof typeof EXTENSION_VERSIONS;
    version: string;
    steps: TestReportStep[];
  };
}
