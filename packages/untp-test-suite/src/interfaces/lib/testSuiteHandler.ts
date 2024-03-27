import { dynamicLoadingSchemaService, hasErrors } from '../../core/index.js';
import { generateTestSuiteResultByTemplate, processCheckDataBySchema } from '../../core/processTestSuite.js';
import { ITestCredentialHandlerResult, ITestMultiCredentialHandlerResult, TestCredentialHandler, TestMultiCredentialHandler } from './types.js';
import { ConfigCredentials, FinalStatus, TemplateName } from '../../core/types/index.js';
import { readJsonFile } from '../utils/common.js';
import { generateFinalMessage } from '../../templates/utils.js';
import { templateMapper } from '../../templates/mapper.js';

/**
 * The purpose of the `testSuiteHandler` function is to read a JSON credential file specified by
 * the `credentialPath` parameter. This file contains credential settings necessary to run
 * the UNTP (UN Transparency Protocol) test suite.
 * 
 * The main functionality is to test your JSON data files to ensure they comply with the UNTP data model.
 * @see Please see {@link https://uncefact.github.io/spec-untp/docs/specification/} for more information.

 * The credential file typically includes a `credentials` field, which is an array containing JSON objects.
 * Each object within this array describes the data file to be tested.
 * 
 * For example:
 * {
 *  "credentials": [
 *    {
 *      "type": "aggregationEvent",
 *      "version": "v0.0.1",
 *      "dataPath": "/data/aggregationEvent.json"
 *    },
 *    {
 *      "type": "conformityEvent",
 *      "version": "v0.0.1",
 *      "dataPath": "/data/conformityEvent.json"
 *    },
 *    {
 *      "type": "productPassport",
 *      "version": "v0.0.1",
 *      "dataPath": "/data/productPassport.json"
 *    },
 *  ]
 * }
 * 
 * Here, the `type` field specifies the schema type and the `version` field specifies the schema version
 * to be used for testing the data file located at the `dataPath` field.
 */

/**
 * Test Suite Result Example:
 *
 * {
 *   credentials: [
 *     {
 *       credentialType: "aggregationEvent",
 *       version: "v0.0.1",
 *       path: "/data/aggregationEvent.json",
 *       result: "PASS"
 *     },
 *     {
 *       credentialType: "conformityEvent",
 *       version: "v0.0.1",
 *       path: "/data/conformityEvent.json",
 *       result: "WARN"
 *       warnings: [
 *         fieldName: "testField",
 *         message: "This schema must NOT have additional properties"
 *       ]
 *     },
 *     {
 *       credentialType: "productPassport",
 *       version: "v0.0.1",
 *       path: "/data/productPassport.json",
 *       result: "FAIL"
 *       errors: [
 *         {
 *           fieldName: "topic"
 *           errorType: "enum"
 *           allowedValues: ["environment.emissions", "environment.water", "environment.waste"],
 *           message: "topic field must be equal to one of the allowed values."
 *         }
 *       ]
 *     }
 *   ],
 *   finalStatus: 'FAIL',
 *   finalMessage: 'Your credentials are not UNTP compliant',
 * 
 *   // finalStatus: 'PASS',
 *   // finalMessage: 'Your credentials are UNTP compliant',

 *   // finalStatus: 'WARN',
 *   // finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
 * }
 * 
 * After running the UNTP test suite, if the data file located at the specified 'dataPath' field passes validation,
 * the 'finalStatus' will be 'PASS'. This indicates that the data file compies with the UNTP data model.
 * However, if the 'finalStatus' is 'WARN' or 'FAIL', it means that although the data file at 'dataPath' may
 * comply with the UNTP data model, it either extends beyond the model or doesn't fully comply with it.
 */


/**
 * The purpose of the `testMultiCredentialHandler` function is to process and test a set of credentials specified either by
 * a direct object or by a file path pointing to a JSON file containing the credentials. These credentials define various
 * data files to be tested for compliance with the UNTP (UN Transparency Protocol) data model. For more information on the UNTP data model,
 * refer to the documentation at: {@link https://uncefact.github.io/spec-untp/docs/specification/}
 * 
 * The main functionality is to validate the JSON data files against corresponding schemas specified in the credentials.
 * 
 * The credential file typically includes a `credentials` field, which is an array containing JSON objects.
 * Each object within this array describes the data file to be tested.
 * 
 * Example of the credentials structure:
 * {
 *   "credentials": [
 *     {
 *       "type": "aggregationEvent",
 *       "version": "v0.0.1",
 *       "dataPath": "/data/aggregationEvent.json"
 *     },
 *     {
 *       "type": "conformityEvent",
 *       "version": "v0.0.1",
 *       "dataPath": "/data/conformityEvent.json"
 *     },
 *     {
 *       "type": "productPassport",
 *       "version": "v0.0.1",
 *       "dataPath": "/data/productPassport.json"
 *     },
 *   ]
 * }
 * 
 * Here, the `type` field specifies the schema type, the `version` field specifies the schema version,
 * and the `dataPath` field specifies the path to the data file to be tested.
 * 
 * After testing each credential, a test suite result is generated containing detailed information about
 * each tested data file, including any warnings or errors encountered during the testing process.
 * 
 * Example of a test suite result:
 * {
 *   credentials: [
 *     {
 *       credentialType: "aggregationEvent",
 *       version: "v0.0.1",
 *       path: "/data/aggregationEvent.json",
 *       result: "PASS"
 *     },
 *     {
 *       credentialType: "conformityEvent",
 *       version: "v0.0.1",
 *       path: "/data/conformityEvent.json",
 *       result: "WARN",
 *       warnings: [
 *         {
 *           fieldName: "testField",
 *           message: "This schema must NOT have additional properties"
 *         }
 *       ]
 *     },
 *     {
 *       credentialType: "productPassport",
 *       version: "v0.0.1",
 *       path: "/data/productPassport.json",
 *       result: "FAIL",
 *       errors: [
 *         {
 *           fieldName: "topic",
 *           errorType: "enum",
 *           allowedValues: ["aggregationEvent", "conformityEvent", "productPassport"],
 *           message: "topic field must be equal to one of the allowed values."
 *         }
 *       ]
 *     }
 *   ],
 *   finalStatus: 'FAIL',
 *   finalMessage: 'Your credentials are not UNTP compliant',
 * 
 *   // finalStatus: 'PASS',
 *   // finalMessage: 'Your credentials are UNTP compliant',
 * 
 *   // finalStatus: 'WARN',
 *   // finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
 * }
 * 
 * After processing all credentials, the function generates a final report containing aggregated information
 * about the test suite, including the overall status (PASS, WARN, or FAIL) and a corresponding message.
 * 
 * @example
 * // Example usage of 'testMultiCredentialHandler' with direct credentials object:
 * const credentialResults = await testMultiCredentialHandler({
 *   credentials: [
 *     {
 *       type: "aggregationEvent",
 *       version: "v0.0.1",
 *       dataPath: "/data/aggregationEvent.json"
 *     },
 *     // Add more credentials as needed...
 *   ]
 * });
 * 
 * @example
 * // Example usage of testMultiCredentialHandler with credentials file path:
 * const credentialResults = await testMultiCredentialHandler('/path/to/credentials.json');
 * 
 * // The 'credentialResults' variable will contain the test suite result.
 */

/**
 * Handles testing of multiple credentials against their respective schemas and generates a final report.
 * @param {string | ConfigCredentials} credentialOrCredentialPath - The path to the credential file or the actual ConfigCredentials object.
 * @returns {Promise<TestSuiteResult>} A promise that resolves to the test results for all credentials and the final report.
 */

export const testMultiCredentialHandler: TestMultiCredentialHandler = async (credentialOrCredentialPath: string | ConfigCredentials): Promise<ITestMultiCredentialHandlerResult> => {
  let credential = credentialOrCredentialPath as ConfigCredentials;

  if (typeof credentialOrCredentialPath === 'string') {
    const configCredentials = await readJsonFile<ConfigCredentials>(credentialOrCredentialPath!);
    if (!configCredentials) {
      throw new Error(`Cannot read the credentials file with ${credentialOrCredentialPath} path.`);
    }

    credential = configCredentials;
  }

  const testCredentialResults = await Promise.all(
    credential.credentials.map(processCheckDataBySchema)
  );

  const testCredentialMessages = await generateTestSuiteResultByTemplate(testCredentialResults);
  const finalReportTemplateData = generateFinalMessage(testCredentialMessages);
  const finalReportJson = await templateMapper(TemplateName.finalReport, finalReportTemplateData);
  const finalReport = JSON.parse(finalReportJson);

  return {
    credentials: testCredentialMessages,
    ...finalReport
  }
}

/**
 * The purpose of the `testCredentialHandler` function is to test a single credential against a given schema.
 * This function is typically used when testing individual data files for compliance with a specific schema
 * version of the UNTP (UN Transparency Protocol) data model.
 * 
 * The main functionality is to validate the JSON data file against a schema specified either directly
 * or loaded dynamically based on the `credentialType` and `credentialVersion` parameters.
 * 
 * Example usage:
 * const credentialResult = await testCredentialHandler("aggregationEvent", "v0.0.1", jsonData);
 * 
 * The function returns a result object containing information about the test result, including any errors
 * or warnings encountered during the validation process.
 * 
 * Example of a credential result object:
 * {
 *   result: "PASS",
 *   credentialType: "aggregationEvent",
 *   version: "v0.0.1",
 *   errors: [],
 *   warnings: []
 * }
 * 
 * If the data file passes validation, the `result` field will be set to "PASS". If there are any validation
 * errors, the `result` field will be set to "FAIL", and the `errors` field will contain detailed information
 * about the validation errors encountered.
 * 
 * If the data file contains additional properties not defined in the schema, but is otherwise valid,
 * the `result` field will be set to "WARN", and the `warnings` field will contain information about
 * the additional properties encountered.
 * 
 * @example
 * // Example usage of testCredentialHandler with direct schema and JSON data:
 * const credentialResult = await testCredentialHandler("aggregationEvent", "v0.0.1", jsonTestData);
 * 
 * @example
 * // Example usage of testCredentialHandler with dynamic schema loading:
 * const credentialResult = await testCredentialHandler(jsonSchema, jsonTestData);
 */


/**
 * Test Credential Handler function.
 * 
 * This function is responsible for testing a credential based on a schema or validating test data against a schema.
 * 
 * @param {string | object} credentialTypeOrSchema - Either the credential type or the schema object.
 * @param {string | object} credentialVersionOrTestData - Either the credential version or the test data object.
 * @param {object} [testData] - Optional test data object.
 * @returns {Promise<ITestCredentialHandlerResult>} A promise that resolves to the result of the credential test.
 */

export const testCredentialHandler: TestCredentialHandler = async (credentialTypeOrSchema: string | object, credentialVersionOrTestData: string | object, testData?: object): Promise<ITestCredentialHandlerResult> => {
  let schema: object = credentialTypeOrSchema as object;
  let schemaTestData: object = credentialVersionOrTestData as object;
  const credentialResult: ITestCredentialHandlerResult = { result: FinalStatus.pass };

  if (typeof credentialTypeOrSchema === 'string' && typeof credentialVersionOrTestData === 'string' && typeof testData === 'object') {
    credentialResult.credentialType = credentialTypeOrSchema;
    credentialResult.version = credentialVersionOrTestData;

    schema = await dynamicLoadingSchemaService(credentialTypeOrSchema, credentialVersionOrTestData);
    schemaTestData = testData;
  }

  credentialResult.errors = hasErrors(schema, schemaTestData);
  if (credentialResult?.errors?.length) {
    const isWarningType = credentialResult.errors.every((error) => error?.params?.additionalProperty);
    credentialResult.result = isWarningType ? FinalStatus.warn : FinalStatus.fail;
  }

  return credentialResult;
}
