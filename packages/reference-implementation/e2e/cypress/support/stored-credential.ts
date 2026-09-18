function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length ${value.length})`;
  if (typeof value !== 'object') return typeof value;
  const keys = Object.keys(value as Record<string, unknown>);
  return `object keys [${keys.join(', ') || 'none'}]`;
}

export function expectStatusListIndex(value: unknown, message: string, wire: 'stored' | 'signed'): void {
  if (wire === 'stored') {
    expect(value, message).to.be.a('string');
    expect(value, message).to.match(/^\d+$/);
    return;
  }
  expect(value, message).to.be.a('number');
  expect(Number.isInteger(value), message).to.eq(true);
}

/**
 * Unwraps a W3C enveloped verifiable credential (`EnvelopedVerifiableCredential`
 * with a `data:<media type>,<JWT>` id) to its inner credential object. A value
 * that is not an envelope is returned unchanged.
 */
export function unwrapEnvelope(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, any>;
  if (record.type !== 'EnvelopedVerifiableCredential' || typeof record.id !== 'string') return value;
  const payload = record.id.split(',')[1]?.split('.')[1];
  if (!payload) return value;
  try {
    // The Cypress browser Buffer polyfill does not know the base64url
    // encoding, so translate to standard base64 first.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Cypress.Buffer.from(base64, 'base64').toString('utf8'));
    if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded.vc && typeof decoded.vc === 'object' ? decoded.vc : decoded;
    }
    return decoded;
  } catch {
    return value;
  }
}

export function decodeStoredCredential(stored: unknown): Record<string, any> {
  const storedRecord = stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : undefined;
  const credentialValue = storedRecord?.verifiableCredential ?? stored;
  const storedShape = describeShape(stored);
  const credentialShape = describeShape(credentialValue);
  if (credentialValue === null || typeof credentialValue !== 'object' || Array.isArray(credentialValue)) {
    throw new Error(`could not decode stored copy (shape: stored ${storedShape}, credential ${credentialShape})`);
  }
  const credential = credentialValue as Record<string, any>;

  const decoded: unknown = unwrapEnvelope(credential);
  if (credential.type === 'EnvelopedVerifiableCredential' && decoded === credential) {
    throw new Error(`could not decode stored copy (shape: stored ${storedShape}, envelope ${credentialShape})`);
  }

  if (
    decoded === null ||
    typeof decoded !== 'object' ||
    Array.isArray(decoded) ||
    !Object.prototype.hasOwnProperty.call(decoded, 'credentialStatus')
  ) {
    throw new Error(
      `could not decode stored copy (shape: stored ${storedShape}, envelope ${credentialShape}, decoded ${describeShape(
        decoded,
      )}; credentialStatus missing)`,
    );
  }
  return decoded as Record<string, any>;
}

type EncryptedStoredCopy = {
  cipherText: string;
  iv: string;
  tag: string;
  type: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeHex(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`Expected a 32-byte hexadecimal decryption key, got ${value.length} characters`);
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

export async function decryptStoredCopy(stored: unknown, decryptionKey: string): Promise<unknown> {
  if (!isRecord(stored)) {
    throw new Error('Expected the storage service to return an encrypted object');
  }

  const envelope = stored as unknown as EncryptedStoredCopy;
  if (
    typeof envelope.cipherText !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    envelope.type !== 'aes-256-gcm'
  ) {
    throw new Error(`Unexpected encrypted stored-copy envelope: ${JSON.stringify(stored)}`);
  }

  const cipherText = decodeBase64(envelope.cipherText);
  const iv = decodeBase64(envelope.iv);
  const tag = decodeBase64(envelope.tag);
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error(`Unexpected AES-GCM envelope lengths: iv=${iv.length}, tag=${tag.length}`);
  }

  const cipherTextWithTag = new Uint8Array(cipherText.length + tag.length);
  cipherTextWithTag.set(cipherText);
  cipherTextWithTag.set(tag, cipherText.length);

  const key = await window.crypto.subtle.importKey(
    'raw',
    asArrayBuffer(decodeHex(decryptionKey)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(iv), tagLength: 128 },
    key,
    asArrayBuffer(cipherTextWithTag),
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}
