/**
 * Returns `value` trimmed if it is a string with non-whitespace content,
 * otherwise `undefined`.
 *
 * Surrounding whitespace is never meaningful in the values this reads (names,
 * identifiers, labels), and a whitespace-only string carries no more
 * information than an absent one, so both collapse to `undefined`.
 *
 * `undefined` rather than `null` because this reports what a document does
 * not contain. Recording that absence as a stored or transmitted value is a
 * separate decision, made by the caller at the boundary where a read becomes
 * a row or a response.
 */
export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
