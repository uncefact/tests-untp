import { SchemeType, TestCaseStatus } from '../../constants';
import { EXTENSION_VERSIONS } from '../lib/schemaValidation';
import { ArtefactSource, Credential } from './credential';
import { TestStep } from './test';
import { PermittedCredentialType } from './untp';

export interface TestReport {
  date: string;
  reportName: string;
  testSuite: {
    runner: string;
    version: string;
  };
  implementation: {
    name: string;
  };
  pass: boolean;
  results: TestReportResult[];
  schemeResults?: TestReportSchemeResult[];
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
  source?: ArtefactSource;
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

export interface TestReportSchemeResult {
  status: TestReportStatus;
  type: SchemeType;
  version: string;
  name?: string;
  id?: string;
  source?: ArtefactSource;
  scheme: Record<string, any>;
  steps: TestReportStep[];
}

export enum DownloadReportFormat {
  HTML = 'html',
  JSON = 'json',
}
