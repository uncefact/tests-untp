/** Formats a bounded boot cause chain while retaining stable error codes. */
export function describeBootError(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  const code = 'code' in error && error.code !== undefined ? ` [${String(error.code)}]` : '';
  const cause =
    error.cause !== undefined && depth < 4 ? `\n  caused by: ${describeBootError(error.cause, depth + 1)}` : '';
  return `${error.message}${code}${cause}`;
}
