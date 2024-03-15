import path from 'path';
import { ConfigCredentials, TestSuite, TestSuiteResult } from './types/index';
import { readJsonFile, validateCredentialConfigs } from './utils/common.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import { hasErrors } from './services/json-schema/validator.service.js';

/**
 * Process the test suite
 * @param credentialConfigsPath - The path to the credential configs
 * @returns The test suite result
 */
export const processTestSuite: TestSuite = async (credentialConfigsPath) => {
  const credentialConfigs = await readJsonFile<ConfigCredentials>(credentialConfigsPath);
  const validateCredentialResult = validateCredentialConfigs(credentialConfigs.credentials);

  const testDataPath = path.resolve(process.cwd(), '../../');
  const testSuiteResultPromises = credentialConfigs.credentials.map<Promise<TestSuiteResult>>(
    async (credentialConfig) => {
      const { type, version, dataPath } = credentialConfig;
      const [schema, data] = await Promise.all([
        dynamicLoadingSchemaService(type, version),
        readJsonFile(`${testDataPath}/${dataPath}`),
      ]);

      const errors = hasErrors(schema, data);

      return {
        ...credentialConfig,
        errors,
      };
    },
  );

  const testSuiteResult = await Promise.all(testSuiteResultPromises);
  testSuiteResult.forEach((result) => {
    if (result.errors && validateCredentialResult && validateCredentialResult?.length > 0) {
      result.errors = [...result.errors, ...validateCredentialResult];
    } else if (validateCredentialResult && validateCredentialResult?.length > 0) {
      result.errors = [...validateCredentialResult];
    }
  });

  return testSuiteResult;
};
