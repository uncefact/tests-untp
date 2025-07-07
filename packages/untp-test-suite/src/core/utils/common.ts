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

export const createInvalidFieldError = (
  invalidField: string,
  credentialConfigsPath?: string,
  message?: string,
): ICredentialConfigError => {
  const error = {
    instancePath: invalidField,
    message: invalidField ? message : null,
    keyword: invalidField ? 'format' : null,
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

    // Check if URL is provided for remote schema validation
    if (!_.isEmpty(credential.url)) {
      const { valid, errorMessage } = validateUrlField(credential, 'url');
      if (!valid && errorMessage) {
        errors.push(createInvalidFieldError('url', credentialConfigsPath, errorMessage));
      }
    } else {
      // URL is empty, so validate version for local schema
      // Note: type is now optional and will be extracted from credential data
      if (_.isEmpty(credential.version)) {
        errors.push(createMissingFieldError('version', credentialConfigsPath));
      }
    }
    if (_.isEmpty(credential.dataPath)) {
      errors.push(createMissingFieldError('dataPath', credentialConfigsPath));
    }
    results.push({ ...credential, errors } as IValidatedCredentials);
  }

  return results;
};

/**
 * Utility function to check if a field in an object is a valid URL.
 *
 * @param obj - The object containing the URL field.
 * @param fieldName - The name of the field to check.
 * @returns {valid: boolean, errorMessage?: string} - Returns an object with the validation result and an error message if invalid.
 */
export const validateUrlField = (
  obj: Record<string, any>,
  fieldName: string,
): { valid: boolean; errorMessage?: string } => {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errorMessage: `The provided object is invalid.` };
  }

  const url = obj[fieldName];

  // Check if the field exists and is a string
  if (typeof url !== 'string' || url.trim() === '') {
    return { valid: false, errorMessage: `The field "${fieldName}" is missing or not a valid string.` };
  }

  // Validate if it's a proper URL using the URL constructor
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return { valid: true };
    } else {
      return { valid: false, errorMessage: `The URL "${url}" must use http or https protocol.` };
    }
  } catch (e) {
    return { valid: false, errorMessage: `The URL "${url}" is not a valid URL.` };
  }
};

export const fetchData = async (url: string): Promise<{ data: any | null; error: string | null; success: boolean }> => {
  if (!url || typeof url !== 'string') {
    return { data: null, error: 'Invalid URL provided.', success: false };
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    return { data, error: null, success: true };
  } catch (e) {
    return { data: null, error: `Failed to fetch data from the URL: ${url}.`, success: false };
  }
};

export const loadDataFromDataPath = async (credentialConfig: IConfigContent, data?: any): Promise<{ data: any }> => {
  const { dataPath } = credentialConfig;
  let _data;

  if (!data && !dataPath) {
    throw new Error('Must provide either data or dataPath to check data by schema.');
  }

  if (!data && dataPath) {
    _data = await readJsonFile(dataPath);
  }

  if (data && !dataPath) {
    _data = { ...data };
  }

  return { data: _data };
};
