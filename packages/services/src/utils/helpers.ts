import _ from 'lodash';
import { IVerifyURLPayload } from '../types/types.js';

export const constructVerifyURL = ({ baseUrl, uri, hash, key }: IVerifyURLPayload & { baseUrl?: string }) => {
  if (!uri || !hash) {
    throw new Error('URI and hash are required');
  }

  if (!baseUrl) {
    const url = new URL(window.location.href);
    baseUrl = `${url.protocol}//${url.host}`;
  }

  const payload: Record<string, string> = { uri, hash };
  if (key) payload.key = key;

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  return `${baseUrl}/verify?${queryString}`;
};

export const validateAndConstructVerifyURL = (value: any) => {
  if (_.isEmpty(value) || _.isNumber(value)) {
    throw new Error('Invalid data');
  }

  // Legacy: accept a bare string URI. Callers should migrate to passing
  // an object with { uri, hash } for full verification URL construction.
  if (_.isString(value)) {
    return value;
  }

  // Handle object with 'uri' key
  if (_.isPlainObject(value) && 'uri' in value) {
    const { uri, key, decryptionKey, hash } = value;
    return constructVerifyURL({ uri, key: key ?? decryptionKey, hash });
  }

  throw new Error('Unsupported value type');
};
