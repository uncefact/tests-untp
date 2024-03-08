export interface TestSuite  {
  (credentialConfigsPath: string): Promise<TestSuiteResult[]>;
}

export interface TestSuiteResult extends ConfigContent {
  result: 'FAIL' | 'PASS';
  errors: string | null;
}

export interface ConfigCredentials {
  credentials: ConfigContent[];
}

export interface ConfigContent {
  type: string;
  version: string;
  dataPath: string;
}
