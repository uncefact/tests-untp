import _ from 'lodash';
import { StorageServiceConfig } from '@mock-app/services';

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
