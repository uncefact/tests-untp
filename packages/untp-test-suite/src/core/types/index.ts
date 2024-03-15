import { ErrorObject } from 'ajv';

export interface ConfigCredentials {
  credentials: ConfigContent[];
}

export interface ConfigContent {
  type: string;
  version: string;
  dataPath: string;

  configPath?: string;
}

export interface TestSuite {
  (credentialConfigsPath: string): Promise<TestSuiteResult[]>;
}

export interface TestErrors {
  errors: ErrorObject[] | string | null;
}

export interface TestSuiteResult extends ConfigContent, TestErrors {}
