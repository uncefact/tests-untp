import fs from 'fs/promises';
import _ from 'lodash';
import { ConfigContent, ICredentialConfig, TestSuiteResult } from '../types';

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
const createMissingFieldError = (
  credential: ConfigContent,
  credentialConfigsPath: string,
  missingField?: string,
): TestSuiteResult => {
  return {
    type: credential.type ?? '',
    version: credential.version ?? '',
    dataPath: credential.dataPath ?? '',
    errors: {
      message: missingField ? `should have required property '${missingField}'` : null,
      keyword: missingField ? 'required' : null,
      configPath: credentialConfigsPath,
    } as ICredentialConfig,
  };
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

  const arrError = [];
  for (const credential of credentialConfigs) {
    if (_.isEmpty(credential.type)) {
      arrError.push(createMissingFieldError(credential, credentialConfigsPath, 'type'));
    } else if (_.isEmpty(credential.version)) {
      arrError.push(createMissingFieldError(credential, credentialConfigsPath, 'version'));
    } else if (_.isEmpty(credential.dataPath)) {
      arrError.push(createMissingFieldError(credential, credentialConfigsPath, 'dataPath'));
    } else {
      arrError.push(createMissingFieldError(credential, credentialConfigsPath));
    }
  }

  return arrError;
};
