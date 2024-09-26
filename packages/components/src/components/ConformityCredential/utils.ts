import _ from 'lodash';
import { StorageServiceConfig } from '@mock-app/services/build/types/storage.js';
import { IVerifyURLPayload } from '../../types/conformityCredential.types';

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

export const constructVerifyURL = ({ uri, key, hash }: IVerifyURLPayload) => {
  if (!uri) {
    throw new Error('URI is required');
  }

  const url = new URL(window.location.href);
  const baseUrl = `${url.protocol}//${url.host}`;

  const payload: IVerifyURLPayload = { uri };
  if (key) {
    payload.key = key;
  }
  if (hash) {
    payload.hash = hash;
  }

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  const verifyURL = `${baseUrl}/verify?${queryString}`;

  return verifyURL;
};

export const detectValueFromStorage = (value: any) => {
  if (_.isEmpty(value) || _.isNumber(value)) {
    throw new Error('Invalid data');
  }

  // Handle string value as URI
  if (_.isString(value)) {
    return constructVerifyURL({ uri: value });
  }

  // Handle object with 'uri' key
  if (_.isPlainObject(value) && 'uri' in value) {
    const { uri, key, hash } = value;
    return constructVerifyURL({ uri, key, hash });
  }

  throw new Error('Unsupported value type');
};
