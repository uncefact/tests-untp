import { TestCredentialHandler, TestCredentialsHandler } from './types.js';
import { ICredentialConfigs, ICredentialTestResult } from '../../core/types/index.js';
import {
  processTestSuite,
  processTestSuiteForConfigPath,
  processTestSuiteForCredential,
} from '../../core/processTestSuite.js';

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
 * // Example usage of 'testCredentialsHandler' with direct credentials object:
 * const credentialResults = await testCredentialsHandler({
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
 * // Example usage of testCredentialsHandler with credentials file path:
 * const credentialResults = await testCredentialsHandler('/path/to/credentials.json');
 *
 * // The 'credentialResults' variable will contain the test suite result.
 */

/**
 * Handles testing of multiple credentials against their respective schemas and generates a final report.
 * @param {string | ICredentialConfigs} credentialConfigsOrCredentialPath - The path to the credential file or the actual ICredentialConfigs object.
 * @returns {Promise<TestSuiteResult>} A promise that resolves to the test results for all credentials and the final report.
 */

export const testCredentialsHandler: TestCredentialsHandler = async (
  credentialConfigsOrCredentialPath: string | ICredentialConfigs,
) => {
  if (typeof credentialConfigsOrCredentialPath === 'string') {
    return processTestSuiteForConfigPath(credentialConfigsOrCredentialPath);
  } else {
    return processTestSuite(credentialConfigsOrCredentialPath);
  }
};

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
 * const credentialResult = await testCredentialHandler({type: "aggregationEvent", version: "v0.0.1"}, jsonTestData);
 */

/**
 * Test Credential Handler function.
 *
 * This function is responsible for testing a credential based on a schema or validating test data against a schema.
 *
 * @param {Omit<ConfigContent, 'dataPath'>} credentialSchemaConfig - The credential schema configuration object.
 * @param {object} [testData] - The test data to be validated against the schema.
 * @returns {Promise<ICredentialTestResult>} A promise that resolves to the result of the credential test.
 */

export const testCredentialHandler: TestCredentialHandler = (credentialSchemaConfig, testData) => {
  return processTestSuiteForCredential(credentialSchemaConfig, testData);
};
