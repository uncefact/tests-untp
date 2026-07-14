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

  // Build the URL through the URL API so the `q` payload is added as a proper
  // query parameter. A base that already carries its own query or fragment
  // (e.g. a verify page that routes by query) keeps them: the query is
  // preserved and `q` is appended, and the fragment stays after the query
  // rather than swallowing it.
  const url = new URL(baseUrl);

  // The verify page reads `uri`, `digestMultibase`, `hash`, and `decryptionKey`
  // as direct query parameters in preference to the `q` payload, so a base URL
  // that already carries any of them (or its own `q`) would shadow this link's
  // own payload. Drop those reserved keys before setting `q`; other parameters
  // are preserved.
  for (const reserved of ['uri', 'digestMultibase', 'hash', 'decryptionKey', 'q']) {
    url.searchParams.delete(reserved);
  }
  url.searchParams.set('q', JSON.stringify({ payload }));
  return url.toString();
};
