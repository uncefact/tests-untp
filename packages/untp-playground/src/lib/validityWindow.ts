import { jwtDecode } from 'jwt-decode';
import { evaluateValidityWindow } from '@uncefact/untp-utils/common';

/**
 * Judges a credential's VCDM 2.0 `validFrom` and `validUntil` with the
 * shared evaluator. An enveloped `vc+jwt` credential is decoded from its
 * `id`; an embedded-proof credential is judged from its body. The
 * verification service reads only the JOSE `exp` and `nbf` claims for an
 * envelope, which the issuer does not set, so without this an expired
 * credential would be reported as verified on its word alone. Returns null
 * when the credential is within its window; an undecodable envelope is left
 * to the signature check.
 */
export function validityWindowError(
  credential: unknown,
  now: Date = new Date(),
): { errorCode: 'expired' | 'not_yet_valid' | 'unreadable_bound'; message: string } | null {
  const claims = validityClaims(credential);
  if (claims === null) return null;
  const outcome = evaluateValidityWindow(claims, now);
  return outcome.result === 'fail' ? { errorCode: outcome.reason, message: outcome.message } : null;
}

function validityClaims(credential: unknown): { validFrom?: unknown; validUntil?: unknown } | null {
  if (typeof credential !== 'object' || credential === null) return null;
  const record = credential as { type?: unknown; id?: unknown; validFrom?: unknown; validUntil?: unknown };
  const types = Array.isArray(record.type) ? record.type : [record.type];
  if (!types.includes('EnvelopedVerifiableCredential')) return record;
  if (typeof record.id !== 'string') return null;
  const jwt = record.id.split(',')[1];
  if (!jwt) return null;
  try {
    const payload: unknown = jwtDecode(jwt);
    return typeof payload === 'object' && payload !== null
      ? (payload as { validFrom?: unknown; validUntil?: unknown })
      : null;
  } catch {
    return null;
  }
}
