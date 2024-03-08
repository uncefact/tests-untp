import Ajv from 'ajv';
import { hasErrors } from './services/index.js';
import { ConfigContent, TestSuite, TestSuiteResult } from './types/index.js';
import { readFile, validateCredentialConfigs } from './utils/common.js';

const ajv = new Ajv();

export const processTestSuite: TestSuite = async (credentialConfigsPath) => {
  const credentialConfigs = await readFile<ConfigContent[]>(credentialConfigsPath);
  validateCredentialConfigs(credentialConfigs);

  const testSuiteResultPromises = credentialConfigs.map<Promise<TestSuiteResult>>(async (credentialConfig) => {
    const { type, version, dataPath } = credentialConfig;
    const schemaPath = `${process.cwd()}/src/schemas/${type}/${version}/schema.json`;
    const testDataPath = `${process.cwd()}/${dataPath}`;

    const [ schema, data ] = await Promise.all([readFile(schemaPath), readFile(testDataPath)]);

    const errors = hasErrors(schema, data);
    return {
      ...credentialConfig,
      result: errors ? 'FAIL' : 'PASS',
      errors: errors ? ajv.errorsText(errors) : null
    }
  });
  
  const testSuiteResult = await Promise.all(testSuiteResultPromises);
  return testSuiteResult;
};
