// eslint-disable-next-line no-control-regex -- intentional: rejecting control chars is the whole point
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;

/**
 * Returns `true` if `value` is free of control characters (CR, LF, NUL,
 * etc.). Use this as the load-bearing security check when echoing any
 * upstream-supplied header value back onto another request: a CR/LF in
 * an attacker-controlled header value enables header-injection attacks.
 *
 * Per-header RFC validators (e.g. {@link parseEntityTag}) call this
 * internally as a fast-fail before their format-specific regex.
 */
export function isSafeHeaderValue(value: string): boolean {
  return typeof value === 'string' && !CONTROL_CHARS_RE.test(value);
}
