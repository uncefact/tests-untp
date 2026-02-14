/**
 * Base error class for all service-layer errors.
 *
 * Carries structured metadata so consumers (e.g. API route handlers) can
 * map errors directly to HTTP responses without brittle string matching.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g. 'IDR_LINK_NOT_FOUND') */
    public readonly code: string,
    /** Suggested HTTP status code for the consumer */
    public readonly statusCode: number,
    /** Optional structured context for logging/debugging */
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
