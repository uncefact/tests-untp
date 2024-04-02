import fs from 'fs/promises';
import _ from 'lodash';
import { IConfigContent, ICredentialConfigError, IValidatedCredentials } from '../types/index.js';

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
const createMissingFieldError = (missingField: string, credentialConfigsPath?: string): ICredentialConfigError => {
  const error = {
    instancePath: missingField,
    message: missingField ? `should have required property` : null,
    keyword: missingField ? 'required' : null,
    dataPath: credentialConfigsPath,
  } as ICredentialConfigError;

  return error;
};

/**
 * Validates an array of credential configurations.
 * @param {IConfigContent[]} credentialConfigs - The array of credential configurations to be validated.
 * @returns {IValidatedCredentials[] | null} An array of errors if the credential configurations are invalid, or null if they are valid.
 */
export const validateCredentialConfigs = (
  credentialConfigs: IConfigContent[],
  credentialConfigsPath?: string,
): IValidatedCredentials[] => {
  if (_.isEmpty(credentialConfigs)) {
    throw new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.');
  }

  const results = [];
  for (const credential of credentialConfigs) {
    const errors = [] as ICredentialConfigError[];
    if (_.isEmpty(credential.type)) {
      errors.push(createMissingFieldError('type', credentialConfigsPath));
    }
    if (_.isEmpty(credential.version)) {
      errors.push(createMissingFieldError('version', credentialConfigsPath));
    }
    if (_.isEmpty(credential.dataPath)) {
      errors.push(createMissingFieldError('dataPath', credentialConfigsPath));
    }
    results.push({ ...credential, errors } as IValidatedCredentials);
  }

  return results;
};
