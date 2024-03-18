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
  (credentialConfigsPath: string): Promise<TestSuiteResult[]>;
}

export interface ICredentialConfig {
  message: string;
  keyword: string;
  configPath: string;
}

export interface TestErrors {
  errors: ErrorObject[] | ICredentialConfig | null;
}

export interface TestSuiteResult extends ConfigContent, TestErrors {}
