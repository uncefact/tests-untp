/**
 * Reduces an exception to its name and message for logging. The cause chain
 * an error carries can hold key material, such as a decryption key inside a
 * wrapped storage or crypto failure, and pino renders a cause chain in full,
 * so the reduction is what keeps it out of a log line.
 *
 * The protection is this function, not the field it is logged under. Call
 * sites use `error` rather than `err` by convention, because `err` is the key
 * pino's own serialiser claims, and passing an already-reduced object through
 * that serialiser changes the rendered shape for no reason.
 */
export function safeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'NonError', message: String(error) };
}
