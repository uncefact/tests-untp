import { ErrorObject } from 'ajv';

export interface TestSuite {
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
