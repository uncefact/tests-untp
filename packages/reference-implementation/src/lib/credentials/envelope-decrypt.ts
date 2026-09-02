/**
 * The one way the key-lifecycle operations try a key against a stored
 * envelope, and the one way they read an error's message. Shared by the
 * audit and the rotation so their notion of "this key opens this envelope"
 * cannot drift.
 */
import type { EncryptedEnvelope, IEncryptionService } from '@uncefact/untp-ri-services/encryption';

/** Null on success; the thrown error (wrapped, so a thrown falsy still registers) on failure. */
export function decryptFailure(
  service: Pick<IEncryptionService, 'decrypt'>,
  envelope: EncryptedEnvelope,
): { error: unknown } | null {
  try {
    service.decrypt(envelope);
    return null;
  } catch (error) {
    return { error };
  }
}

/**
 * Duck-typed rather than `instanceof Error`: the services package can throw
 * from another realm (it does under jest), which would silently drop the
 * message.
 */
export function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
}
