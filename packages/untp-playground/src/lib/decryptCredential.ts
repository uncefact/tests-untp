import { jwtDecode } from 'jwt-decode';

/**
 * In-browser decryption of an encrypted credential envelope (#813).
 *
 * The envelope is the storage service's AES-GCM form confirmed against live resolvers (#818,
 * #812): base64 `cipherText`, 12-byte base64 `iv`, 16-byte base64 `tag`, `type: 'aes-256-gcm'`,
 * mirroring the services package's AES-GCM adapter (no additional authenticated data, utf8
 * plaintext, 64-character hex key). WebCrypto's AES-GCM takes the ciphertext and auth tag
 * concatenated.
 *
 * The key never leaves this function: it is imported as a non-extractable WebCrypto key for the
 * single decrypt call, never stored, logged, or sent anywhere. Callers hold it in component state
 * only.
 */

export interface EncryptedCredentialEnvelope {
  cipherText: string;
  iv: string;
  tag: string;
  type: string;
}

export type DecryptCredentialResult =
  | { ok: true; credential: unknown }
  | { ok: false; reason: 'malformed-key' | 'unsupported-envelope' | 'decrypt-failed' };

const KEY_PATTERN = /^[0-9a-f]{64}$/i;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function decodedBase64Length(value: unknown): number | undefined {
  // Canonical base64 (what the storage adapter emits) is always a multiple of four characters;
  // anything else (like 'A=') would throw inside atob AFTER the key form was offered.
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    return undefined;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * Whether the envelope is one THIS decryptor can open: exactly the canonical storage contract
 * (type 'aes-256-gcm', base64 fields, 12-byte IV, 16-byte auth tag), mirroring the services
 * adapter. Encrypted forms outside it (JWE, other AES variants, wrong field lengths) are still
 * honestly locked, but asking for a 64-hex key that can never work would be a lie, so the panel
 * uses this to decide whether to offer the key form at all.
 */
export function isDecryptableEnvelope(envelope: EncryptedCredentialEnvelope): boolean {
  return (
    envelope.type?.trim().toLowerCase() === 'aes-256-gcm' &&
    decodedBase64Length(envelope.cipherText) !== undefined &&
    decodedBase64Length(envelope.iv) === 12 &&
    decodedBase64Length(envelope.tag) === 16
  );
}

/** Whether a typed key has the envelope contract's shape: 64 hexadecimal characters (32 bytes). */
export function isWellFormedKey(key: string): boolean {
  return KEY_PATTERN.test(key.trim());
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Compact JWS (three base64url segments, empty signature allowed), as the fetch parser accepts. */
const COMPACT_JWS = /^[\w-]+\.[\w-]+\.[\w-]*$/;

function parsePlaintext(plaintext: string): DecryptCredentialResult {
  try {
    return { ok: true, credential: JSON.parse(plaintext) };
  } catch {
    // Not JSON; the stored credential may itself be a compact JWS.
  }
  const trimmed = plaintext.trim();
  if (COMPACT_JWS.test(trimmed)) {
    try {
      return { ok: true, credential: jwtDecode(trimmed) };
    } catch {
      return { ok: false, reason: 'decrypt-failed' };
    }
  }
  return { ok: false, reason: 'decrypt-failed' };
}

/**
 * A short human label for why an encrypted document cannot be decrypted here, naming the method
 * where the document declares one. The value comes from untrusted resolver documents, so it is
 * length-capped; React renders it as text.
 */
export function describeUndecryptableEnvelope(value: unknown): string {
  if (typeof value === 'string') return 'JWE';
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.ciphertext === 'string') return 'JWE';
    if (typeof candidate.type === 'string' && candidate.type.trim().length > 0) {
      const label = candidate.type.trim().slice(0, 40);
      return label.toLowerCase() === 'aes-256-gcm' ? 'a malformed aes-256-gcm envelope' : `"${label}"`;
    }
  }
  return 'an unrecognised method';
}

/**
 * Decrypts the envelope with the given hex key, entirely client-side. Every failure (malformed
 * key, wrong key, corrupt envelope, undecodable plaintext) collapses to `{ ok: false }`: AES-GCM
 * authentication cannot distinguish a wrong key from corrupt data, so the caller's single
 * "Couldn't decrypt with that key" message is as much as can honestly be said.
 */
export async function decryptCredential(
  envelope: EncryptedCredentialEnvelope,
  key: string,
): Promise<DecryptCredentialResult> {
  // A malformed key is distinguishable BEFORE any crypto runs (wrong-key versus corrupt data is
  // not, by AES-GCM design), so the caller can tell the user the input shape is the problem.
  if (!isDecryptableEnvelope(envelope)) return { ok: false, reason: 'unsupported-envelope' };
  if (!isWellFormedKey(key)) return { ok: false, reason: 'malformed-key' };
  try {
    const cipherText = base64ToBytes(envelope.cipherText);
    const tag = base64ToBytes(envelope.tag);
    const combined = new Uint8Array(new ArrayBuffer(cipherText.length + tag.length));
    combined.set(cipherText);
    combined.set(tag, cipherText.length);

    const cryptoKey = await crypto.subtle.importKey('raw', hexToBytes(key.trim()), 'AES-GCM', false, ['decrypt']);
    const plaintextBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv), tagLength: 128 },
      cryptoKey,
      combined,
    );
    return parsePlaintext(new TextDecoder().decode(plaintextBytes));
  } catch {
    // Wrong key or corrupt envelope: WebCrypto rejects with an opaque OperationError by design.
    return { ok: false, reason: 'decrypt-failed' };
  }
}
