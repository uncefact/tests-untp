import _ from 'lodash';
import JSONPointer from 'jsonpointer';
import { StorageServiceConfig } from '@mock-app/services/build/types/storage.js';

export type Result<T> = { ok: true; value: T } | { ok: false; value: string };

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  value: message,
});

/**
 * Check if the stored credentials are valid
 * @param storedCredentialsConfig Stored credentials
 * @returns The stored credentials if they are valid
 */
export const checkStoredCredentialsConfig = (
  storedCredentialsConfig: StorageServiceConfig,
): Result<StorageServiceConfig> => {
  if (_.isEmpty(storedCredentialsConfig)) return error('Invalid upload credential config');
  if (_.isEmpty(storedCredentialsConfig.url)) return error('Invalid upload credential config url');

  return { ok: true, value: storedCredentialsConfig };
};

/**
 * Define the path to access the credential or the link to the credential within the API response
 * @param apiResp API response data
 * @param path Path to the credential or the link to the credential within the API response
 * @returns The credential or the link to the credential within the API response
 */
export const getCredentialByPath = (apiResp: any, path: string) => {
  if (_.isNil(path)) {
    throw new Error('Invalid credential path');
  }

  return JSONPointer.get(apiResp, path);
};
