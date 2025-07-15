import { ErrorObject } from 'ajv';

export interface ICredentialConfigs {
  credentials: IConfigContent[];
}

export interface IConfigContent {
  type?: string;
  version?: string;
  dataPath?: string;
  url?: string;
}

export interface ICredentialConfigError {
  instancePath: string;
  message: string;
  keyword: string;
  dataPath: string;
}

export interface ITestErrors {
  errors: ErrorObject[] | ICredentialConfigError[] | null;
}

export interface IValidatedCredentials extends ITestErrors {
  type: string;
  version: string;
  dataPath?: string;
  url?: string;
}

export interface ICredentialTestResult {
  credentialType: string;
  version: string;
  path?: string;
  url?: string;
  result: TestSuiteResultEnum;
  warnings?: IWarning[];
  errors?: IError[];
}

export interface IWarning {
  fieldName: string;
  message: string;
}

export interface IError {
  fieldName: string;
  errorType: string;
  allowedValues?: string[];
  message: string;
}

export interface IFinalReport {
  finalStatus: TestSuiteResultEnum;
  finalMessage: TestSuiteMessageEnum;
}

export interface IValidationTemplateData {
  result: TestSuiteResultEnum;
  templates: TemplateEnum[];
  warnings?: ErrorObject[];
  errors?: ErrorObject[];
}

export interface ITestSuiteResult extends IFinalReport {
  credentials: ICredentialTestResult[];
}

export enum TestSuiteResultEnum {
  PASS = 'PASS',
  FAIL = 'FAIL',
  WARN = 'WARN',
}

export enum TemplateEnum {
  CREDENTIAL_RESULT = 'credentialResult',
  ERRORS = 'errors',
  WARNINGS = 'warnings',
  FINAL_REPORT = 'finalReport',
}

export enum TestSuiteMessageEnum {
  PASS = 'Your credentials are UNTP compliant',
  WARN = 'Your credentials are UNTP compliant, but have extended the data model',
  FAIL = 'Your credentials are not UNTP compliant',
}
