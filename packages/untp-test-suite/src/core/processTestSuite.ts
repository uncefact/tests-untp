import {
  IConfigContent,
  ICredentialConfigs,
  ICredentialTestResult,
  IValidatedCredentials,
  ITestSuiteResult,
} from './types/index.js';
import {
  createInvalidFieldError,
  readJsonFile,
  validateCredentialConfigs,
  loadDataFromDataPath,
  extractVersionFromContext,
  extractCredentialType,
} from './utils/common.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import { hasErrors } from './services/json-schema/validator.service.js';
import {
  constructCredentialTestResult,
  constructCredentialTestResults,
  constructFinalReport,
} from '../templates/utils.js';
import { filterValidFiles } from '../utils/fileScanner.js';

/**
 * Function to validate the provided data against a schema.
 *
 * @param {string} filePath - The path to the credential file.
 * @param {object} data - The data to be validated.
 * @param {string} [url] - Optional URL to fetch the schema from.
 * @returns {IValidatedCredentials} The result of the validation with any errors.
 */
export const processCheckDataBySchema = async (
  filePath: string,
  data: object,
  url?: string,
): Promise<IValidatedCredentials> => {
  // Extract type from credential data
  const effectiveType = extractCredentialType(data);
  if (!effectiveType) {
    throw new Error('Unable to determine credential type. Credential data must contain a valid type property.');
  }

  // Extract version from credential data
  const effectiveVersion = extractVersionFromContext(data);
  if (!effectiveVersion) {
    throw new Error(
      'Unable to determine credential version. Credential data must contain a valid @context with version information.',
    );
  }

  const schema = await dynamicLoadingSchemaService(effectiveType, effectiveVersion, url);

  const errors: any = [];
  if (typeof schema === 'string') {
    errors.push(createInvalidFieldError('schema', filePath, schema));
  } else {
    const validationErrors = hasErrors(schema, data);
    if (validationErrors) {
      errors.push(...validationErrors);
    }
  }

  return {
    type: effectiveType,
    version: effectiveVersion,
    dataPath: filePath,
    url: url || '',
    errors,
  };
};

/**
 * Process the test suite for a list of file paths (primary function)
 * @param filePaths - Array of file paths to process
 * @returns The test suite result
 */
export const processTestSuite = async (filePaths: string[]): Promise<ITestSuiteResult> => {
  try {
    // Filter out invalid file paths
    const validFilePaths = await filterValidFiles(filePaths);

    if (validFilePaths.length === 0) {
      throw new Error('No valid credential files found in the provided paths');
    }

    // Process each file path to check data by schema
    const validatedCredentials = await Promise.all(
      validFilePaths.map(async (filePath) => {
        try {
          const { data: credentialData } = await loadDataFromDataPath({ dataPath: filePath });
          return processCheckDataBySchema(filePath, credentialData as object);
        } catch (error) {
          // Return validation error for files that can't be loaded
          return {
            type: 'Unknown',
            version: 'Unknown',
            dataPath: filePath,
            url: '',
            errors: [
              createInvalidFieldError(
                'file',
                filePath,
                `Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              ),
            ],
          };
        }
      }),
    );

    // Mapping message templates and final report
    const credentialResults = await constructCredentialTestResults(validatedCredentials);
    const finalReport = await constructFinalReport(credentialResults);

    return {
      credentials: credentialResults,
      ...finalReport,
    };
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to run the test suite. ${error.message}`);
  }
};

/**
 * Process the test suite for config-based input (legacy wrapper function)
 * @param credentialConfigs - The credential configurations
 * @param credentialConfigsPath - Optional path to the config file
 * @returns The test suite result
 */
export const processTestSuiteForConfigs = async (
  credentialConfigs: ICredentialConfigs,
  credentialConfigsPath?: string,
): Promise<ITestSuiteResult> => {
  const validateCredentialResult = validateCredentialConfigs(credentialConfigs.credentials, credentialConfigsPath);

  // Filter out configs with no errors
  const configContentNoError = validateCredentialResult.filter((config) => config.errors?.length === 0);

  // Process each config to check data by schema
  const validatedCredentials = await Promise.all(
    configContentNoError.map(async (credentialConfig) => {
      const { data: credentialData } = await loadDataFromDataPath(credentialConfig);
      return processCheckDataBySchema(credentialConfig.dataPath || '', credentialData as object, credentialConfig.url);
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
 * Process the test suite for a config file path (legacy wrapper function)
 * @param credentialConfigsPath - The path to the credential configs
 * @returns The test suite result
 */
export const processTestSuiteForConfigPath = async (credentialConfigsPath: string): Promise<ITestSuiteResult> => {
  try {
    // Read and validate credential configs
    const credentialConfigs = await readJsonFile<ICredentialConfigs>(credentialConfigsPath);
    return processTestSuiteForConfigs(credentialConfigs, credentialConfigsPath);
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to run the test suite. ${error.message}`);
  }
};

/**
 * Process a single credential file (primary function)
 * @param filePath - Path to the credential file
 * @param data - Optional data override
 * @param url - Optional URL to fetch schema from
 * @returns The credential test result
 */
export const processTestSuiteForCredential = async (
  filePath: string,
  data?: object,
  url?: string,
): Promise<ICredentialTestResult> => {
  const { data: credentialData } = await loadDataFromDataPath({ dataPath: filePath }, data);
  const rawCredentialResult = await processCheckDataBySchema(filePath, credentialData as object, url);
  return constructCredentialTestResult(rawCredentialResult);
};
