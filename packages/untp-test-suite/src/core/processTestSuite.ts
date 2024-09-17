import {
  IConfigContent,
  ICredentialConfigs,
  ICredentialTestResult,
  IValidatedCredentials,
  ITestSuiteResult,
  ICredentialConfigError,
} from './types/index.js';
import { fetchData, loadDataFromDataPath, readJsonFile, validateCredentialConfigs } from './utils/common.js';
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
export const processCheckDataBySchema = (
  schema: object,
  data: object,
  credentialConfig: IConfigContent,
): IValidatedCredentials => {
  const errors = hasErrors(schema, data);

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

  const validatedCredentials = await Promise.all(
    configContentNoError.map(async (credentialConfig) => {
      // Load schema
      let schema;

      if (credentialConfig.url) {
        const { data, error, success } = await fetchData(credentialConfig.url);
        // Handle fetch failure
        if (!success) {
          // Return the credential config with the error
          return {
            ...credentialConfig,
            errors: [
              {
                instancePath: 'url',
                message: error,
                keyword: 'FetchError',
                dataPath: credentialConfig.dataPath,
              },
            ] as ICredentialConfigError[],
          };
        }

        schema = data;
      } else {
        schema = await dynamicLoadingSchemaService(credentialConfig.type, credentialConfig.version);
      }

      // Load data and validate
      const { data } = await loadDataFromDataPath(credentialConfig);

      // Validate data against schema
      return processCheckDataBySchema(schema, data, credentialConfig);
    }),
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

/**
 * Process the test suite for a single credential
 * @param configContent
 * @param data
 * @returns The test result for the credential
 */
export const processTestSuiteForCredential = async (
  configContent: IConfigContent,
  data?: object,
): Promise<ICredentialTestResult> => {
  // Load schema
  let schema;

  if (configContent.url) {
    schema = await fetchData(configContent.url);
  } else {
    schema = await dynamicLoadingSchemaService(configContent.type, configContent.version);
  }

  // Load data and validate
  const { data: dataPath } = await loadDataFromDataPath(configContent, data);

  // Validate data against schema
  const rawCredentialResult = processCheckDataBySchema(schema, dataPath, configContent);
  return constructCredentialTestResult(rawCredentialResult);
};
