import {
  IConfigContent,
  ICredentialConfigs,
  ICredentialTestResult,
  IValidatedCredentials,
  ITestSuiteResult,
} from './types/index.js';
import { createInvalidFieldError, readJsonFile, validateCredentialConfigs } from './utils/common.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import { hasErrors } from './services/json-schema/validator.service.js';
import {
  constructCredentialTestResult,
  constructCredentialTestResults,
  constructFinalReport,
} from '../templates/utils.js';
/**
 * Function to validate the provided data against a schema.
 *
 * @param {object} schema - The schema to validate against.
 * @param {object} data - The data to be validated.
 * @param {IConfigContent} credentialConfig - The original credential configuration.
 * @returns {IValidatedCredentials} The result of the validation with any errors.
 */
export const processCheckDataBySchema = async (
  credentialConfig: IConfigContent,
  data?: object,
): Promise<IValidatedCredentials> => {
  const { dataPath } = credentialConfig;
  let _data;

  if (!data && !dataPath) {
    throw new Error('Must provide either data or dataPath to check data by schema.');
  }

  if (!data && dataPath) {
    _data = await readJsonFile(dataPath);
  }

  if (data && !dataPath) {
    _data = { ...data };
  }

  const schema = await dynamicLoadingSchemaService(credentialConfig);

  const errors: any = [];
  if (typeof schema === 'string') {
    errors.push(createInvalidFieldError('schema', dataPath, schema));
  } else {
    const validationErrors = hasErrors(schema, _data);
    if (validationErrors) {
      errors.push(...validationErrors);
    }
  }

  return {
    ...credentialConfig,
    errors,
  };
};

/**
 * Process the test suite
 * @param credentialConfigsPath - The path to the credential configs
 * @returns The test suite result
 */
export const processTestSuiteForConfigPath = async (credentialConfigsPath: string): Promise<ITestSuiteResult> => {
  try {
    // Read and validate credential configs
    const credentialConfigs = await readJsonFile<ICredentialConfigs>(credentialConfigsPath);
    return processTestSuite(credentialConfigs, credentialConfigsPath);
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to run the test suite. ${error.message}`);
  }
};

export const processTestSuite = async (
  credentialConfigs: ICredentialConfigs,
  credentialConfigsPath?: string,
): Promise<ITestSuiteResult> => {
  const validateCredentialResult = validateCredentialConfigs(credentialConfigs.credentials, credentialConfigsPath);

  // Filter out configs with no errors
  const configContentNoError = validateCredentialResult.filter((config) => config.errors?.length === 0);

  // Process each config to check data by schema
  const validatedCredentials = await Promise.all(
    configContentNoError.map((credentialConfig) => processCheckDataBySchema(credentialConfig)),
  );

  // Add configs with errors
  const configsContainingErrors = validateCredentialResult.filter(
    (config) => config?.errors && config.errors?.length > 0,
  );
  validatedCredentials.push(...configsContainingErrors);

  // Mapping message templates and final report
  const credentialResults = await constructCredentialTestResults(validatedCredentials);
  const finalReport = await constructFinalReport(credentialResults);

  return {
    credentials: credentialResults,
    ...finalReport,
  };
};

export const processTestSuiteForCredential = async (
  configContent: IConfigContent,
  data?: object,
): Promise<ICredentialTestResult> => {
  const rawCredentialResult = await processCheckDataBySchema(configContent, data);
  return constructCredentialTestResult(rawCredentialResult);
};
