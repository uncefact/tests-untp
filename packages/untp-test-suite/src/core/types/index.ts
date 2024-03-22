import { ErrorObject } from 'ajv';

export interface ConfigCredentials {
  credentials: ConfigContent[];
}

export interface ConfigContent {
  type: string;
  version: string;
  dataPath: string;
}

export interface TestSuite {
  (credentialConfigsPath: string): Promise<TestSuiteResult>;
}

export interface ICredentialConfigError {
  instancePath: string;
  message: string;
  keyword: string;
  dataPath: string;
}

export interface TestErrors {
  errors: ErrorObject[] | ICredentialConfigError[] | null;
}

export interface IValidatedCredentials extends ConfigContent, TestErrors {}

export interface ICredentialTestResult {
  credentialType: string;
  version: string;
  path: string;
  result: string;
  warnings?: string[];
  error?: string[];
}

export interface IFinalReport {
  finalStatus: FinalStatus;
  finalMessage: TestSuiteMessage;
}

export interface TestSuiteResult extends IFinalReport {
  credentials: ICredentialTestResult[];
}

export enum FinalStatus {
  fail = 'FAIL',
  pass = 'PASS',
  warn = 'WARN',
}

export enum TemplateName {
  error = 'error',
  pass = 'pass',
  warn = 'warning',
  finalReport = 'finalReport',
}

export enum TestSuiteMessage {
  Pass = 'Your credentials are UNTP compliant',
  Warning = 'Your credentials are UNTP compliant, but have extended the data model',
  Fail = 'Your credentials are not UNTP compliant',
}
