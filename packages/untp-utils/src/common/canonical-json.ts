/**
 * Serialises JSON-compatible values in a deterministic RFC 8785-style form:
 * object keys are sorted by code unit, whitespace is omitted, arrays retain
 * their order, scalar values use `JSON.stringify`, object keys with undefined
 * values are omitted as `JSON.stringify` does, and a top-level undefined
 * throws.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new TypeError('Top-level undefined cannot be canonicalised');
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  const serialised = JSON.stringify(value);
  if (serialised === undefined) throw new TypeError('Value cannot be canonicalised as JSON');
  return serialised;
}
