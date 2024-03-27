import { ErrorObject } from 'ajv';
import { ConfigCredentials, FinalStatus, ICredentialTestResult, TestSuiteResult } from '../../core/types/index.js';

export interface ITestMultiCredentialHandlerResult {
  credentials: ICredentialTestResult[],
  result: FinalStatus
  version?: string,
  errors?: ErrorObject[] | null,
}

export interface ITestCredentialHandlerResult {
  credentialType?: string,
  version?: string,
  errors?: ErrorObject[] | null,
  result: FinalStatus
}

export interface TestMultiCredentialHandler {
  // This library function is intended for the test suite function to read the `credentials.json` file by the `credentialPath` parameter and run the entire test suite.
  (credentialPath: string): Promise<ITestMultiCredentialHandlerResult>;

  // This library function is used to pass the configuration credentials directly into the parameter and then run the test suite with those parameters.
  (credential: ConfigCredentials): Promise<ITestMultiCredentialHandlerResult>;
};

export interface TestCredentialHandler {
  // This library function is used to test a credential that specifies the credential type, version, and the test data that the user wants to test.
  (credentialType: string, credentialVersion: string, testData: object): Promise<ITestCredentialHandlerResult>;

  // This library function is used when a user wants to pass the schema directly to test with the provided test data.
  (schema: object, testData: object): Promise<ITestCredentialHandlerResult>;
};
