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
  const validateCredentialResult = validateCredentialConfigs(credentialConfigsPath, credentialConfigs.credentials);

  const configContentNoError = validateCredentialResult.filter((config) => config.errors === null);

  const testDataPath = path.resolve(process.cwd(), '../../');
  const testSuiteResultPromises = configContentNoError.map<Promise<TestSuiteResult>>(async (credentialConfig) => {
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
  });

  const testSuiteResult = await Promise.all(testSuiteResultPromises);
  const configsContainingErrors = validateCredentialResult.filter((config) => config.errors !== null);
  testSuiteResult.push(...configsContainingErrors);

  return testSuiteResult;
};
