import { evaluateValidityWindow, type ValidityWindowOutcome } from '@uncefact/untp-utils/common';
import type { EnvelopedVerifiableCredential } from '../types.js';
import { decodeCredential } from './decode-credential.js';

/**
 * The outcome of judging an enveloped credential's validity window: the
 * shared claims judgement (`evaluateValidityWindow` in untp-utils), or
 * `not_run` when the envelope cannot be decoded, which the signature check
 * owns.
 */
export type EnvelopeValidityWindowOutcome = ValidityWindowOutcome | { result: 'not_run'; reason: 'undecodable' };

/**
 * Decodes an enveloped `vc+jwt` credential and judges its `validFrom` and
 * `validUntil` against `now` with the shared claims evaluator. Every
 * verification path in the reference implementation applies this, because
 * the pinned provider does not enforce those claims for this envelope
 * format.
 */
export function checkValidityWindow(
  credential: EnvelopedVerifiableCredential,
  now: Date = new Date(),
): EnvelopeValidityWindowOutcome {
  let claims: { validFrom?: unknown; validUntil?: unknown };
  try {
    const decoded: unknown = decodeCredential(credential);
    if (typeof decoded !== 'object' || decoded === null) return { result: 'not_run', reason: 'undecodable' };
    claims = decoded as { validFrom?: unknown; validUntil?: unknown };
  } catch {
    return { result: 'not_run', reason: 'undecodable' };
  }
  return evaluateValidityWindow(claims, now);
}
