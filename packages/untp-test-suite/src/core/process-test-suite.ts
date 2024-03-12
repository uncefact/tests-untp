import path from 'path';
import { ConfigCredentials, TestSuite, TestSuiteResult } from './types/index';
import { readFile, validateCredentialConfigs } from './utils/common.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import { hasErrors } from './services/json-schema/validator.service.js';

export const processTestSuite: TestSuite = async (credentialConfigsPath) => {
  const credentialConfigs = await readFile<ConfigCredentials>(credentialConfigsPath);
  validateCredentialConfigs(credentialConfigs.credentials);

  const testDataPath = path.resolve(process.cwd(), '../../');
  const testSuiteResultPromises = credentialConfigs.credentials.map<Promise<TestSuiteResult>>(
    async (credentialConfig) => {
      const { type, version, dataPath } = credentialConfig;
      const [schema, data] = await Promise.all([
        dynamicLoadingSchemaService(type, version),
        readFile(`${testDataPath}/${dataPath}`),
      ]);

      const errors = hasErrors(schema, data);

      return {
        ...credentialConfig,
        errors,
      };
    },
  );

  const testSuiteResult = await Promise.all(testSuiteResultPromises);
  return testSuiteResult;
};
