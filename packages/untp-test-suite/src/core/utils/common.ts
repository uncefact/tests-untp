import fs from 'fs/promises';
import _ from 'lodash';
import { ConfigContent } from '../types';

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
 * Validates an array of credential configurations.
 * @param {ConfigContent[]} credentialConfigs - The array of credential configurations to be validated.
 * @throws {Error} Throws an error if the credentialConfigs array is empty or if any credential object is missing required fields.
 */
export const validateCredentialConfigs = (credentialConfigs: ConfigContent[]) => {
  if (_.isEmpty(credentialConfigs)) {
    throw new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.');
  }

  for (let i = 0; i < credentialConfigs.length; i++) {
    const credential = credentialConfigs[i];
    if (_.isEmpty(credential.type) || _.isEmpty(credential.version) || _.isEmpty(credential.dataPath)) {
      throw new Error(
        `Each credential object must contain 'type', 'version', and 'dataPath' fields. Please ensure all required fields are provided.`,
      );
    }
  }
};
