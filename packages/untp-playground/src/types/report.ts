import { SchemeType, TestCaseStatus } from '../../constants';
import { EXTENSION_VERSIONS } from '../lib/schemaValidation';
import { ArtefactSource, Credential, StoredCredential, StoredScheme } from './credential';
import { TestStep } from './test';
import { PermittedCredentialType } from './untp';

/** One loaded credential instance and its pipeline result, as the report consumes it (ADR-041). */
export interface CredentialReportInput {
  credential: StoredCredential;
  steps: TestStep[];
}

/** One loaded scheme instance and its pipeline result, as the report consumes it (ADR-041). */
export interface SchemeReportInput {
  scheme: StoredScheme;
  steps: TestStep[];
}

export interface TestReport {
  date: string;
  reportName: string;
  testSuite: {
    runner: string;
    version: string;
    url?: string;
  };
  implementation: {
    name: string;
  };
  pass: boolean;
  verifiableCredentials: TestReportResult[];
  conformitySchemeResults?: TestReportSchemeResult[];
  playgroundUrl?: string;
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
  overallStatus: TestReportStatus;
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
  overallStatus: TestReportStatus;
  type: SchemeType;
  version: string;
  name?: string;
  id?: string;
  source?: ArtefactSource;
  conformityScheme: Record<string, any>;
  steps: TestReportStep[];
}

export enum DownloadReportFormat {
  HTML = 'html',
  JSON = 'json',
}
