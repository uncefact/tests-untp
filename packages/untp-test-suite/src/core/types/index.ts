import { ErrorObject } from 'ajv';

export interface TestRunner {
  (): Promise<(ErrorObject[] | null)[]>;
}

export interface ConfigCredentials {
  credentials: ConfigContent[];
}

export interface ConfigContent {
  type: string;
  version: string;
  dataPath: string;
}
