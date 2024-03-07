export interface TestRunner {
  (): unknown;
}

export interface ConfigCredentials {
  credentials: { type: string; version: string; dataPath: string }[];
}
