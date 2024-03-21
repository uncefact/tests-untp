export enum TestSuiteResultEnum {
  PASS = 'PASS',
  FAIL = 'FAIL',
  WARN = 'WARN',
}

export interface ITestSuiteResult {
  credentialTestResults: ICredentialTestResult[];
  finalStatus: TestSuiteResultEnum;
  finalMessage: string;
}

export interface ICredentialTestResult {
  credentialType: string;
  version: string;
  path: string;
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