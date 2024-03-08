export interface TestRunner {
  (): unknown;
}

export interface ConfigCredentials {
  credentials: ConfigContent[];
}

export interface ConfigContent {
  type: string;
  version: string;
  dataPath: string;
}
