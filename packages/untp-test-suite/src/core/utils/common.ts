import fs from 'fs/promises';
import _ from 'lodash';
import { ConfigContent, ICredentialConfigError, TestSuiteResult } from '../types';

/**
 * Asynchronously reads a file and parses its content as JSON.
 * @param {string} filePath - The path to the file to be read.
 * @returns {Promise<T>} A promise that resolves with the parsed content of the file.
 * @template T
 */

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(fileContent);
};

/**
 * Map the required error object
 * @param {string} missingField - The name of the field that is required.
 * @returns {ErrorObject} The required error object.
 */
const createMissingFieldError = (credentialConfigsPath: string, missingField?: string): ICredentialConfigError => {
  const error = {
    message: missingField ? `should have required property '${missingField}'` : null,
    keyword: missingField ? 'required' : null,
    configPath: credentialConfigsPath,
  } as ICredentialConfigError;
  return error;
};

/**
 * Validates an array of credential configurations.
 * @param {ConfigContent[]} credentialConfigs - The array of credential configurations to be validated.
 * @returns {TestSuiteResult[] | null} An array of errors if the credential configurations are invalid, or null if they are valid.
 */
export const validateCredentialConfigs = (
  credentialConfigsPath: string,
  credentialConfigs: ConfigContent[],
): TestSuiteResult[] => {
  if (_.isEmpty(credentialConfigs)) {
    throw new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.');
  }

  const results = [];
  for (const credential of credentialConfigs) {
    const errors = [] as ICredentialConfigError[];
    if (_.isEmpty(credential.type)) {
      errors.push(createMissingFieldError(credentialConfigsPath, 'type'));
    }
    if (_.isEmpty(credential.version)) {
      errors.push(createMissingFieldError(credentialConfigsPath, 'version'));
    }
    if (_.isEmpty(credential.dataPath)) {
      errors.push(createMissingFieldError(credentialConfigsPath, 'dataPath'));
    }
    results.push({ ...credential, errors } as TestSuiteResult);
  }

  return results;
};
