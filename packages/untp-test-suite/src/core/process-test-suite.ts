import path from 'path';
import { TestSuite } from './types/index';
import { readConfigFile, readFile } from './utils/common.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import { hasErrors } from './services/json-schema/validator.service.js';

export const processTestSuite: TestSuite = async () => {
  const credentialConfigs = await readConfigFile();
  const testDataPath = path.resolve(process.cwd(), '../../');
  const testSuiteResultPromises = credentialConfigs.credentials.map(async (credentialConfig) => {
    const { type, version, dataPath } = credentialConfig;
    const [schema, data] = await Promise.all([
      dynamicLoadingSchemaService(type, version),
      readFile(`${testDataPath}/${dataPath}`),
    ]);

    const errors = hasErrors(schema, data);

    return errors;
  });

  const testSuiteResult = await Promise.all(testSuiteResultPromises);
  return testSuiteResult;
};
