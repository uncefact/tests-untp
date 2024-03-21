import {
  ConfigContent,
  ConfigCredentials,
  IValidatedCredentials,
  ICredentialTestResult,
  IFinalReport,
  TemplateName,
  TestSuite,
} from './types/index.js';
import { readJsonFile, validateCredentialConfigs } from './utils/common.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import { hasErrors } from './services/json-schema/validator.service.js';
import { templateMapper } from '../templates/mapper.js';
import { getTemplateName } from '../templates/getTemplateName.js';
import { generateFinalMessage } from '../templates/generateFinalMessage.js';

const processCheckDataBySchema = async (credentialConfig: ConfigContent): Promise<IValidatedCredentials> => {
  const { type, version, dataPath } = credentialConfig;
  const [schema, data] = await Promise.all([dynamicLoadingSchemaService(type, version), readJsonFile(dataPath)]);

  const errors = hasErrors(schema, data);

  return {
    ...credentialConfig,
    errors,
  };
};

const generateTestSuiteResultByTemplate = async (
  testSuiteResultAjv: IValidatedCredentials[],
): Promise<ICredentialTestResult[]> => {
  const credentialsTemplate = await Promise.all(
    testSuiteResultAjv.map(async (value) => {
      const templateName = getTemplateName(value);
      const message = await templateMapper(templateName, value);

      return JSON.parse(message);
    }),
  );

  return credentialsTemplate;
};

/**
 * Process the test suite
 * @param credentialConfigsPath - The path to the credential configs
 * @returns The test suite result
 */
export const processTestSuite: TestSuite = async (credentialConfigsPath) => {
  try {
    // Read and validate credential configs
    const credentialConfigs = await readJsonFile<ConfigCredentials>(credentialConfigsPath);
    const validateCredentialResult = validateCredentialConfigs(credentialConfigsPath, credentialConfigs.credentials);

    // Filter out configs with no errors
    const configContentNoError = validateCredentialResult.filter((config) => config.errors?.length === 0);

    // Process each config to check data by schema
    const dataCheckPromises = configContentNoError.map(processCheckDataBySchema);
    const validatedCredentials = await Promise.all(dataCheckPromises);

    // Add configs with errors
    const configsContainingErrors = validateCredentialResult.filter(
      (config) => config?.errors && config.errors?.length > 0,
    );
    validatedCredentials.push(...configsContainingErrors);

    // Generate final report
    const credentialsTemplate = await generateTestSuiteResultByTemplate(validatedCredentials);
    const finalReport = generateFinalMessage(credentialsTemplate);
    const mappingFinalReport = await templateMapper(TemplateName.finalReport, {
      finalStatus: finalReport.finalStatus,
      finalMessage: finalReport.finalMessage,
    });

    const parsedMappingFinalReport = JSON.parse(mappingFinalReport) as IFinalReport;

    return {
      credentials: credentialsTemplate,
      finalStatus: parsedMappingFinalReport?.finalStatus,
      finalMessage: parsedMappingFinalReport?.finalMessage,
    };
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to run the test suite. ${error.message}`);
  }
};
