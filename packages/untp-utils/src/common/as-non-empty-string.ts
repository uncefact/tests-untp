/**
 * Returns `value` if it is a non-empty string, otherwise `undefined`.
 * Useful inside parsers that emit a structured failure separately when a
 * required field is missing or malformed, so the type check and the
 * failure-emission policy stay decoupled.
 */
export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
