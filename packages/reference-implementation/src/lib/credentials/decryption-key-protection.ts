import {
  EncryptionAlgorithm,
  isEncryptedEnvelope,
  hasValidEnvelopeStructure,
} from '@uncefact/untp-ri-services/encryption';
import type { EncryptedEnvelope } from '@uncefact/untp-ri-services/encryption';
import { StructuredError } from '@uncefact/untp-utils';
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { getEncryptionService } from '../encryption/encryption';
import { appLogger } from '../api/logger';

const logger = appLogger.child({ module: 'decryption-key-protection' });

declare const protectedDecryptionKey: unique symbol;

/**
 * A decryption key already wrapped for persistence by
 * {@link protectDecryptionKey}. The brand is the only thing that separates
 * a wrapped key from a raw one, because both are strings and
 * {@link revealDecryptionKey} returns a raw value unchanged, so a raw key
 * written to a key column would read back correctly everywhere except in the
 * database itself (#697). The two repository create inputs that write a key
 * column take this type and nothing else; writes through the Prisma client
 * or the key-lifecycle stores are still plain strings.
 */
export type ProtectedDecryptionKey = string & { readonly [protectedDecryptionKey]: true };

/**
 * Wraps a storage-service decryption key in an AES-256-GCM envelope for
 * persistence, so the raw database row does not expose a usable key.
 */
export function protectDecryptionKey(key: string): ProtectedDecryptionKey;
export function protectDecryptionKey(key: string | undefined): ProtectedDecryptionKey | undefined;
export function protectDecryptionKey(key: string | undefined): ProtectedDecryptionKey | undefined {
  if (key === undefined) {
    return undefined;
  }
  return JSON.stringify(getEncryptionService().encrypt(key, EncryptionAlgorithm.AES_256_GCM)) as ProtectedDecryptionKey;
}

/**
 * Whether a persisted decryption key value is already an encrypted envelope,
 * as opposed to a plaintext key written before keys were encrypted at rest.
 */
export function isProtectedDecryptionKey(stored: string): boolean {
  return parseEnvelope(stored) !== null;
}

/**
 * The stored envelope could not be opened with the deployment's current
 * wrapping key. Named so a caller can tell this apart from a failure to
 * resolve the encryption service at all, which throws before any ciphertext is
 * touched and calls for the opposite repair. The message and cause are what
 * they were before this class existed.
 */
export class DecryptionKeyUnwrapError extends StructuredError {
  constructor(cause: unknown) {
    super({
      code: 'credentials.decryption-key-unwrap',
      message:
        'Failed to decrypt the stored credential decryption key. ' +
        'DATA_ENCRYPTION_KEY may not match the key in use when the credential was stored.',
      cause,
    });
  }
}

/**
 * The deployment's encryption service could not be resolved, so no stored
 * envelope anywhere in the deployment can be opened. Raised in place of
 * whatever `getEncryptionService` throws, which is a bare `Error`, so a caller
 * that must separate a deployment-wide configuration fault from one damaged
 * row can classify by class rather than by matching message text. The
 * resolver's own sentence is kept after the prefix because it names the
 * variable to repair and holds no key material.
 */
export class EncryptionServiceUnavailableError extends StructuredError {
  constructor(cause: unknown) {
    super({
      code: 'credentials.encryption-service-unavailable',
      message: `The deployment encryption service could not be resolved: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    });
  }
}

/**
 * The stored value is envelope-shaped but is not a valid envelope, so it was
 * never passed to the revealer. Declared here beside the two classes
 * {@link revealDecryptionKey} raises so that all three causes of an
 * unavailable key carry a namespaced code, and an operator alert can key on
 * the code rather than on message text. This module never raises it: the
 * caller that recognises the state with {@link looksEnvelopeLikeButInvalid}
 * constructs it, because no reveal is attempted. It has no cause for the same
 * reason. The message names the state and holds no part of the stored value.
 */
export class DecryptionKeyEnvelopeMalformedError extends StructuredError {
  constructor() {
    super({
      code: 'credentials.decryption-key-envelope-malformed',
      message:
        'The stored decryption key is envelope-shaped but is not a valid envelope, so it was never passed to the revealer.',
    });
  }
}

/** Options for {@link revealDecryptionKey}. */
export type RevealDecryptionKeyOptions = {
  /**
   * Whether an unwrap failure writes this module's own error line. Defaults to
   * true. A caller passes false only when it emits its own error-level event
   * for the same failure, so the operator still gets exactly one line; it is
   * never a way to make the failure quiet.
   */
  logUnwrapFailure?: boolean;
};

/**
 * Recovers the plaintext decryption key from its persisted form.
 *
 * Rows written before the key was encrypted at rest hold the plaintext key
 * directly; anything that is not an encrypted envelope is returned unchanged.
 *
 * Throws {@link DecryptionKeyUnwrapError} when a stored envelope cannot be
 * decrypted, for example when `DATA_ENCRYPTION_KEY` has changed since the
 * credential was stored, and {@link EncryptionServiceUnavailableError} when
 * the deployment key cannot be resolved at all. Both are the only two classes
 * this function raises once it holds an envelope, so a caller classifying the
 * repair needs no third branch and never reads a message.
 *
 * The overloads carry the fact the body already guarantees: null in is the
 * only way out is null, so a caller that has already established it holds a
 * stored value gets a key or an exception, never a null it must re-handle.
 */
export function revealDecryptionKey(stored: string, options?: RevealDecryptionKeyOptions): string;
export function revealDecryptionKey(stored: string | null, options?: RevealDecryptionKeyOptions): string | null;
export function revealDecryptionKey(stored: string | null, options: RevealDecryptionKeyOptions = {}): string | null {
  if (stored === null) {
    return null;
  }

  const envelope = parseEnvelope(stored);
  if (envelope === null) {
    warnIfEnvelopeLike(stored);
    return stored;
  }

  // Resolved outside the decrypt try/catch so a missing or malformed
  // DATA_ENCRYPTION_KEY surfaces its own precise error rather than the
  // key-mismatch message below, and wrapped in its own class so that
  // difference survives as something a caller can test for.
  let encryptionService;
  try {
    encryptionService = getEncryptionService();
  } catch (error) {
    throw new EncryptionServiceUnavailableError(error);
  }

  try {
    return encryptionService.decrypt(envelope);
  } catch (error) {
    if (options.logUnwrapFailure !== false) {
      logger.error({ err: error }, 'Failed to decrypt stored credential decryption key');
    }
    throw new DecryptionKeyUnwrapError(error);
  }
}

/**
 * Whether a stored value resembles an encrypted envelope without being one
 * (for example a truncated or corrupted envelope). Such values are neither
 * decryptable nor plausible legacy plaintext, so writers must not re-encrypt
 * them as if they were legitimate keys.
 *
 * The leading brace is looked for after leading whitespace, because
 * `JSON.parse` accepts whitespace before the opening brace. A classifier that
 * required the brace at index 0 would call a whitespace-prefixed corrupt
 * envelope legacy plaintext, and writers would re-encrypt it. The stored
 * value itself is never modified.
 */
export function looksEnvelopeLikeButInvalid(stored: string): boolean {
  return stored.trimStart().startsWith('{') && parseEnvelope(stored) === null;
}

/**
 * Parses a stored value as an encrypted envelope, returning `null` when it
 * is not valid JSON, does not have the envelope shape, or is envelope-shaped
 * with fields that decode to the wrong byte length for its algorithm (a
 * genuine IV/tag length problem, not a `DATA_ENCRYPTION_KEY` mismatch. See
 * `hasValidEnvelopeStructure`'s own doc comment for why this must be
 * checked before decrypting rather than inferred from decrypt's error).
 * Exported so other modules that need the same "is this a genuine,
 * decrypt-safe envelope" check (rather than just decrypting) do not
 * re-implement the parse-shape-structure pipeline. See
 * validate-encryption-key-startup.ts.
 */
export function parseEnvelope(stored: string): EncryptedEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!isEncryptedEnvelope(parsed)) {
    return null;
  }
  return hasValidEnvelopeStructure(parsed) ? parsed : null;
}

function warnIfEnvelopeLike(stored: string): void {
  if (stored.trimStart().startsWith('{')) {
    logger.warn(
      'Stored decryption key resembles an encrypted envelope but could not be parsed as one; treating it as a legacy plaintext key',
    );
  }
}
