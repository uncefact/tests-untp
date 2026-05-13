import { v4 as uuidv4 } from 'uuid';
import { IVerifyURLPayload } from '../types/types.js';

export function generateUUID() {
  return uuidv4();
}

export function generateCurrentDatetime() {
  return new Date().toISOString();
}

export const constructVerifyURL = ({
  baseUrl,
  uri,
  digestMultibase,
  decryptionKey,
}: IVerifyURLPayload & { baseUrl?: string }) => {
  if (!uri || !digestMultibase) {
    throw new Error('URI and digestMultibase are required');
  }

  if (!baseUrl) {
    const url = new URL(window.location.href);
    baseUrl = `${url.protocol}//${url.host}/verify`;
  }

  const payload: Record<string, string> = { uri, digestMultibase };
  if (decryptionKey) payload.decryptionKey = decryptionKey;

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  return `${baseUrl}?${queryString}`;
};
