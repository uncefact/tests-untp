/**
 * Postgres refuses a NUL byte inside a text value (SQLSTATE 22021), so an id carrying one
 * can match no stored row and must not reach the query, where it would surface as an
 * unhandled database error rather than a miss.
 */
export function containsNulByte(value: string): boolean {
  return value.includes('\0');
}
