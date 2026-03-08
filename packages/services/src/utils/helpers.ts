import { v4 as uuidv4 } from 'uuid';
import { IVerifyURLPayload } from '../types/types.js';

export function generateUUID() {
  return uuidv4();
}

export function generateCurrentDatetime() {
  return new Date().toISOString();
}

export const constructVerifyURL = ({ baseUrl, uri, hash, decryptionKey }: IVerifyURLPayload & { baseUrl?: string }) => {
  if (!uri || !hash) {
    throw new Error('URI and hash are required');
  }

  if (!baseUrl) {
    const url = new URL(window.location.href);
    baseUrl = `${url.protocol}//${url.host}`;
  }

  const payload: Record<string, string> = { uri, hash };
  if (decryptionKey) payload.decryptionKey = decryptionKey;

  const queryString = `q=${encodeURIComponent(JSON.stringify({ payload }))}`;
  return `${baseUrl}/verify?${queryString}`;
};
