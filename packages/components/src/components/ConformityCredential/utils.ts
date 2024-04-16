import _ from 'lodash';
import { IStoredCredentials } from '../../types/conformityCredential.types.js';

export type Result<T> = { ok: true; value: T } | { ok: false; value: string };

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  value: message,
});

/**
 * Check if the stored credentials are valid
 * @param storedCredentials Stored credentials
 * @returns The stored credentials if they are valid
 */
export const checkStoredCredentials = (storedCredentials: IStoredCredentials): Result<IStoredCredentials> => {
  if (_.isEmpty(storedCredentials)) return error('Invalid upload credential config');

  if (_.isEmpty(storedCredentials.url)) return error('Invalid upload credential config url');

  return { ok: true, value: storedCredentials };
};

/**
 * Define the path to access the credential or the link to the credential within the API response
 * @param apiResp API response data
 * @param path Path to the credential or the link to the credential within the API response
 * @returns The credential or the link to the credential within the API response
 */
export const getCredentialByPath = (apiResp: any, path: string) => {
  if (typeof apiResp !== 'object' || !apiResp) {
    return apiResp;
  }

  if (!path) {
    return apiResp;
  }

  const keys = path.split('.');
  let value = apiResp;

  for (const key of keys) {
    if (!value.hasOwnProperty(key)) {
      return undefined; // Property does not exist
    }
    value = value[key];
  }

  return value;
};
