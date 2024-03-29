import { ErrorObject } from 'ajv';
import { ICredentialConfigs, ICredentialTestResult, ITestSuiteResult, IConfigContent } from '../../core/types/index.js';

export interface TestCredentialsHandler {
  // This library function is intended for the test suite function to read the `credentials.json` file by the `credentialPath` parameter and run the entire test suite.
  (credentialPath: string): Promise<ITestSuiteResult>;

  // This library function is used to pass the configuration credentials directly into the parameter and then run the test suite with those parameters.
  (credential: ICredentialConfigs): Promise<ITestSuiteResult>;
}

export interface TestCredentialHandler {
  // This library function is used to test a credential that specifies the credential type, version, and the test data that the user wants to test.
  (credentialSchema: Omit<IConfigContent, 'dataPath'>, testData: object): Promise<ICredentialTestResult>;
}
