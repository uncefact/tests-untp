/**
 * Shared Idempotency-Key request machinery. This module digests the raw
 * body, parses the header, and classifies a stored claim as a mismatch or
 * in-flight conflict. Copy that names a specific operation stays with that
 * operation's route.
 */

import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { ConflictError, UnprocessableError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const IDEMPOTENCY_KEY_MISMATCH_MESSAGE = 'This Idempotency-Key was already used with a different request body.';
export const IDEMPOTENCY_KEY_IN_FLIGHT_MESSAGE =
  'A request with this Idempotency-Key is still being processed. Retry shortly.';
export const IDEMPOTENCY_KEY_HELD_ELSEWHERE_MESSAGE =
  "Another request now holds this Idempotency-Key. Retry to receive that request's result.";

const IDEMPOTENCY_KEY_CHARSET_MESSAGE = 'Idempotency-Key must contain only printable ASCII characters';

/**
 * Digest of the raw request bytes, stored as `bodyDigest` and compared for
 * equality. Encoded as a multibase multihash rather than bare hex so the
 * value is self-describing. If the algorithm ever changes, a stored digest
 * still says which algorithm produced it, instead of comparing unequal
 * against a freshly computed one and reporting a mismatch to a caller who
 * did resend the same body.
 */
export async function digestRequestBody(bytes: Uint8Array): Promise<string> {
  const digest = await MultibaseDigest.fromData(bytes, { algorithm: 'sha2-256', base: 'base58btc' });
  return digest.toString();
}

/**
 * Returns the trimmed Idempotency-Key, or undefined when the header is
 * absent. Throws ValidationError when the trimmed value is blank, longer
 * than {@link IDEMPOTENCY_KEY_MAX_LENGTH}, or contains a character outside
 * printable ASCII (space through tilde).
 */
export function parseIdempotencyKeyHeader(req: Request): string | undefined {
  const raw = req.headers.get('Idempotency-Key');
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ValidationError(
      `Idempotency-Key must be a non-blank string of at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    );
  }
  if (/[^\x20-\x7E]/.test(trimmed)) {
    throw new ValidationError(IDEMPOTENCY_KEY_CHARSET_MESSAGE);
  }
  return trimmed;
}

/**
 * Maps a stored-claim classification onto the HTTP error the caller sees.
 * `mismatch` is 422 `IDEMPOTENCY_KEY_MISMATCH`. `in-flight` is 409
 * `IDEMPOTENCY_KEY_IN_FLIGHT`.
 */
export function throwIdempotencyClassification(outcome: 'mismatch' | 'in-flight'): never {
  if (outcome === 'mismatch') {
    throw new UnprocessableError(IDEMPOTENCY_KEY_MISMATCH_MESSAGE, 'IDEMPOTENCY_KEY_MISMATCH');
  }
  throw new ConflictError(IDEMPOTENCY_KEY_IN_FLIGHT_MESSAGE, 'IDEMPOTENCY_KEY_IN_FLIGHT');
}
