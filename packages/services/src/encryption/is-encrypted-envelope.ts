import { permittedAlgorithms, ALGORITHM_FIELD_LENGTHS } from './encryption.interface.js';
import type { EncryptedEnvelope } from './encryption.interface.js';

// cipherText/iv/tag are the Base64 encoding of the envelope contract every
// consumer of this predicate relies on, so validating the encoding here is
// contract-safe rather than an algorithm-specific detail. A length of 1 mod
// 4 can never be produced by a Base64 encoder (a trailing group is 2, 3, or
// 4 characters, never 1), which is what closes the reported hole: fields
// like 'a' / 'b' / 'c' pass a presence-and-type check but decode leniently
// to 0 bytes via Node's Buffer.from(str, 'base64') instead of throwing.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 === 1) {
    return false;
  }
  if (!BASE64_PATTERN.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').length > 0;
}

/**
 * Checks whether the given value is a well-formed encrypted envelope: has
 * cipherText, iv, and tag fields that are non-empty, validly-encoded
 * Base64, and a type field naming a permitted algorithm. Field presence
 * alone is not enough — a value with the right keys but null, wrongly-typed,
 * or malformed-Base64 fields (or an unsupported algorithm) is not
 * decryptable data, and treating it as a genuine envelope sends a caller
 * into `decrypt()`, which fails with a confusing crypto error ("Invalid
 * initialization vector", "Unsupported algorithm: ...") that reads as a key
 * problem rather than the corruption it actually is.
 *
 * This checks Base64 *encoding* validity only, not algorithm-specific
 * decoded byte lengths (AES-256-GCM's 12-byte IV / 16-byte tag) — that is
 * left to callers that already know which algorithm they are decrypting
 * with, so this shared, algorithm-agnostic predicate does not encode
 * AES-GCM's structural specifics.
 */
export function isEncryptedEnvelope(data: unknown): data is EncryptedEnvelope {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  if (!('cipherText' in data) || !('iv' in data) || !('tag' in data) || !('type' in data)) {
    return false;
  }
  const { cipherText, iv, tag, type } = data as Record<'cipherText' | 'iv' | 'tag' | 'type', unknown>;
  return (
    typeof cipherText === 'string' &&
    typeof iv === 'string' &&
    typeof tag === 'string' &&
    typeof type === 'string' &&
    permittedAlgorithms.has(type) &&
    isValidBase64(cipherText) &&
    isValidBase64(iv) &&
    isValidBase64(tag)
  );
}

/**
 * Checks that an envelope already confirmed by {@link isEncryptedEnvelope}
 * also has the correct decoded byte length for its algorithm's IV and auth
 * tag ({@link ALGORITHM_FIELD_LENGTHS}). This is deliberately a separate
 * function rather than folded into `isEncryptedEnvelope`: field presence,
 * type, and Base64 validity are algorithm-agnostic facts about the
 * envelope's shape, but "how many decoded bytes an IV/tag must be" is
 * specific to the named algorithm, so callers that need this check compose
 * it explicitly rather than the shared shape predicate assuming one
 * algorithm's structure for all of them.
 *
 * This must run before `decrypt()` is attempted, not be inferred from
 * whatever it throws: Node's AES-GCM implementation does not reliably
 * reject a wrong-length IV or tag at construction, and when it does not,
 * the eventual failure throws the exact same error a genuinely wrong key
 * produces ("Unsupported state or unable to authenticate data"), so
 * catching and inspecting that error cannot distinguish corruption from a
 * key mismatch after the fact.
 */
export function hasValidEnvelopeStructure(envelope: EncryptedEnvelope): boolean {
  const lengths = ALGORITHM_FIELD_LENGTHS[envelope.type];
  return (
    Buffer.from(envelope.iv, 'base64').length === lengths.ivBytes &&
    Buffer.from(envelope.tag, 'base64').length === lengths.tagBytes
  );
}
