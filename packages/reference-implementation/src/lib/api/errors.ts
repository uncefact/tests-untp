/**
 * The body text returned when an error has no deliberate mapping, so nothing
 * of the underlying failure reaches the client. Shared by the route-error
 * mapper's database branch and the auth pipeline's boundary.
 */
export const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error has occurred.';

/**
 * The same message with the request's correlation id appended, so a caller
 * who cannot act on the failure themselves has the one identifier that ties
 * their request to its server-side logs. Falls back to the bare message when
 * called outside a request context, where no id exists to quote.
 */
export function unexpectedErrorMessage(correlationId: string | undefined): string {
  return correlationId
    ? `${UNEXPECTED_ERROR_MESSAGE} If the issue persists, please contact support and quote correlation id "${correlationId}".`
    : UNEXPECTED_ERROR_MESSAGE;
}

/**
 * Extract a human-readable message from an unknown caught value.
 */
export function errorMessage(e: unknown, fallback: string = UNEXPECTED_ERROR_MESSAGE): string {
  return e instanceof Error ? e.message : fallback;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ConflictError';
    if (code !== undefined) this.code = code;
  }
}

export class UnprocessableError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'UnprocessableError';
    if (code !== undefined) this.code = code;
  }
}

/**
 * Thrown when the request body cannot be read at all, for example when the
 * connection drops mid-upload. Distinct from malformed JSON: nothing has been
 * parsed at this point, so the caller must not be pointed at their JSON. The
 * reader raises this and the body parser renders it as the 400 it has always
 * been.
 */
export class RequestBodyUnreadableError extends Error {
  constructor() {
    super('Could not read the request body');
    this.name = 'RequestBodyUnreadableError';
  }
}

export class PayloadTooLargeError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
    if (code !== undefined) this.code = code;
  }
}

export class ServiceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceRegistryError';
  }
}

export class ServiceInstanceNotFoundError extends ServiceRegistryError {
  constructor(instanceId: string) {
    super(`Service instance not found: ${instanceId}`);
    this.name = 'ServiceInstanceNotFoundError';
  }
}

export class ServiceResolutionError extends ServiceRegistryError {
  constructor(serviceType: string, tenantId: string) {
    super(
      `No service instance available for type "${serviceType}" ` +
        `in tenant "${tenantId}". ` +
        `Configure a primary instance or ensure a system default exists.`,
    );
    this.name = 'ServiceResolutionError';
  }
}

export class ConfigDecryptionError extends ServiceRegistryError {
  constructor(instanceId: string) {
    super(
      `Failed to decrypt configuration for service instance "${instanceId}". ` +
        `Check that DATA_ENCRYPTION_KEY matches the key used during encryption.`,
    );
    this.name = 'ConfigDecryptionError';
  }
}

export class ConfigValidationError extends ServiceRegistryError {
  constructor(instanceId: string, details: string) {
    super(`Configuration validation failed for service instance "${instanceId}": ${details}`);
    this.name = 'ConfigValidationError';
  }
}
