import fs from 'fs/promises';
import _ from 'lodash';
import { ConfigContent, TestErrors } from '../types';
import { ErrorObject } from 'ajv';

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
 * @param {string} fieldName - The name of the field that is required.
 * @returns {ErrorObject} The required error object.
 */
const mapingRequiredErrorObjectType = (fieldName: string): ErrorObject => {
  return {
    keyword: 'required',
    dataPath: '',
    schemaPath: '#/required',
    params: { missingProperty: fieldName },
    message: `should have required property '${fieldName}'`,
  };
};

/**
 * Validates an array of credential configurations.
 * @param {ConfigContent[]} credentialConfigs - The array of credential configurations to be validated.
 * @returns {ErrorObject[] | null} An array of errors if the credential configurations are invalid, or null if they are valid.
 */
export const validateCredentialConfigs = (credentialConfigs: ConfigContent[]): ErrorObject[] | null => {
  if (_.isEmpty(credentialConfigs)) {
    throw new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.');
  }

  const arrError = [];
  for (let i = 0; i < credentialConfigs.length; i++) {
    const credential = credentialConfigs[i];
    if (_.isEmpty(credential.type)) {
      arrError.push(mapingRequiredErrorObjectType('type'));
    }
    if (_.isEmpty(credential.version)) {
      arrError.push(mapingRequiredErrorObjectType('version'));
    }
    if (_.isEmpty(credential.dataPath)) {
      arrError.push(mapingRequiredErrorObjectType('dataPath'));
    }
  }

  if (arrError.length > 0) {
    return arrError;
  }

  return null;
};
