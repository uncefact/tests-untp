import { processTestSuite } from '../../core/processTestSuite.js';
import { TestSuiteHandler } from './types.js';

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
 * @param credentialPath - The path to the credential file
 * @return {Promise<TestSuiteResult>} - a Promise resolving to the result of the processed test suite. 
 */

export const testSuiteHandler: TestSuiteHandler = async (credentialPath: string) => {
  const testSuiteResult = await processTestSuite(credentialPath);
  return testSuiteResult;
}
