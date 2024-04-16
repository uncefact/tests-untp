import _ from 'lodash';
import { IStoredCredentials } from '../../types/conformityCredential.types.js';

export type Result<T> = { ok: true; value: T } | { ok: false; value: string };

export const error: <T>(message: string) => Result<T> = (message) => ({
  ok: false,
  value: message,
});

export const checkStoredCredentials = (storedCredentials: IStoredCredentials): Result<IStoredCredentials> => {
  if (_.isEmpty(storedCredentials)) return error('Invalid upload credential config');

  if (_.isEmpty(storedCredentials.url)) return error('Invalid upload credential config url');

  return { ok: true, value: storedCredentials };
};
