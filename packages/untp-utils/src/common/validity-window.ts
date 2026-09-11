import { asDateTime } from './as-date-time.js';

/**
 * The outcome of judging a credential's validity window at a point in time.
 *
 * - `pass`: the credential is within its window now. A credential with
 *   neither bound is "valid indefinitely" (VCDM 2.0, Validity Period) and
 *   passes.
 * - `fail`: the credential is outside its window (`expired`,
 *   `not_yet_valid`), or a bound is present but is malformed or in a form
 *   this evaluator does not support (`unreadable_bound`). A present bound is
 *   never dropped: a credential whose bound cannot be read is not the same
 *   as a credential without one.
 */
export type ValidityWindowOutcome =
  | { result: 'pass' }
  | { result: 'fail'; reason: 'expired' | 'not_yet_valid' | 'unreadable_bound'; message: string };

/**
 * Judges the VCDM 2.0 `validFrom` and `validUntil` claims against `now`,
 * comparing them as points on a timeline as the data model requires.
 *
 * Supported form: an XML Schema `dateTimeStamp` written as
 * `YYYY-MM-DDTHH:MM:SS[.fraction]` followed by `Z` or an offset within
 * `-14:00`..`+14:00`, with uppercase `T` and `Z`, naming a calendar day that
 * exists. XML Schema's `24:00:00` end-of-day form, a lowercase separator, an
 * offset outside that range, an impossible day and any non-string value are
 * unreadable and fail as `unreadable_bound`, naming the bound, rather than
 * being normalised to a date the credential never asserted.
 *
 * Comparison is at millisecond precision: a fraction finer than that in a
 * bound is truncated when the bound is parsed, so a bound within the same
 * millisecond as `now` is treated as reached. `now` must be a valid Date;
 * an invalid one is a caller error and throws rather than judging anything.
 *
 * Verification providers may not enforce these claims for every securing
 * mechanism (the pinned VCKit reads only the JOSE `exp` and `nbf` claims for
 * a `vc+jwt` envelope), so every verification path applies this judgement
 * to the credential's own claims.
 */
export function evaluateValidityWindow(
  claims: { validFrom?: unknown; validUntil?: unknown },
  now: Date = new Date(),
): ValidityWindowOutcome {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('evaluateValidityWindow requires a valid Date for now');
  }
  const from = readBound(claims.validFrom);
  const until = readBound(claims.validUntil);
  if (from.state === 'readable' && now < from.date) {
    return {
      result: 'fail',
      reason: 'not_yet_valid',
      message: `Credential is not yet valid: validFrom ${from.date.toISOString()} is after ${now.toISOString()}`,
    };
  }
  if (until.state === 'readable' && now > until.date) {
    return {
      result: 'fail',
      reason: 'expired',
      message: `Credential has expired: validUntil ${until.date.toISOString()} is before ${now.toISOString()}`,
    };
  }
  const unreadable = [
    from.state === 'unreadable' ? 'validFrom' : null,
    until.state === 'unreadable' ? 'validUntil' : null,
  ].filter((name): name is string => name !== null);
  if (unreadable.length > 0) {
    return {
      result: 'fail',
      reason: 'unreadable_bound',
      message: `${unreadable.join(' and ')} could not be read as a date-time`,
    };
  }
  return { result: 'pass' };
}

type Bound = { state: 'absent' } | { state: 'unreadable' } | { state: 'readable'; date: Date };

const DATE_TIME_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/;

function readBound(value: unknown): Bound {
  // Only an omitted property is an absent bound; an explicit null is a
  // present value the data model does not allow.
  if (value === undefined) return { state: 'absent' };
  if (typeof value !== 'string' || !DATE_TIME_STAMP.test(value)) return { state: 'unreadable' };
  const date = asDateTime(value);
  return date === undefined ? { state: 'unreadable' } : { state: 'readable', date };
}
