import { StructuredError } from '../structured-error.js';

/**
 * Base for every diagnostic from `@uncefact/untp-utils/resolvers`.
 * Catch to handle any resolver failure generically; catch a concrete
 * subclass for specific handling. URL-shape failures (invalid URL,
 * unsupported scheme, private hostname, resolution failure, private
 * address) surface as `UrlValidationError` subclasses from the
 * underlying `validatePublicUrl` call rather than being re-wrapped here.
 */
export class ResolverError extends StructuredError {}

/** The fetch call rejected before producing a response (TCP/TLS error, DNS race, etc.). */
export class ResolverNetworkError extends ResolverError {
  constructor(url: string, cause: unknown) {
    super({
      code: 'resolver.network-error',
      message: `Network error fetching ${url}.`,
      received: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/** The remote returned a non-success HTTP status. */
export class ResolverHttpError extends ResolverError {
  readonly status: number;
  constructor(url: string, status: number) {
    super({
      code: 'resolver.http-error',
      message: `${url} returned status ${status}.`,
      received: status,
      expected: '2xx',
    });
    this.status = status;
  }
}

/** The response body exceeded the configured size cap. */
export class ResolverTooLargeError extends ResolverError {
  readonly limit: number;
  constructor(url: string, limit: number) {
    super({
      code: 'resolver.too-large',
      message: `Response body for ${url} exceeds ${limit}-byte limit.`,
      received: `> ${limit} bytes`,
      expected: `<= ${limit} bytes`,
    });
    this.limit = limit;
  }
}

/** A redirect chain exceeded the configured maximum hop count. */
export class ResolverTooManyRedirectsError extends ResolverError {
  readonly limit: number;
  constructor(url: string, limit: number) {
    super({
      code: 'resolver.too-many-redirects',
      message: `Exceeded ${limit} redirect hops starting from ${url}.`,
      received: `> ${limit} hops`,
      expected: `<= ${limit} hops`,
    });
    this.limit = limit;
  }
}

/** The fetch was aborted by the timeout signal. */
export class ResolverTimedOutError extends ResolverError {
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number, cause?: unknown) {
    super({
      code: 'resolver.timed-out',
      message: `Request to ${url} timed out after ${timeoutMs}ms.`,
      received: `> ${timeoutMs}ms`,
      expected: `<= ${timeoutMs}ms`,
      cause,
    });
    this.timeoutMs = timeoutMs;
  }
}

/** A 3xx response was received without a parseable `Location` header. */
export class ResolverRedirectMissingLocationError extends ResolverError {
  constructor(url: string, received: string | number, cause?: unknown) {
    super({
      code: 'resolver.redirect-missing-location',
      message: `Redirect from ${url} had no parseable Location header.`,
      received,
      cause,
    });
  }
}

/** The response body was fetched but could not be parsed as JSON. */
export class ResolverInvalidJsonError extends ResolverError {
  constructor(url: string, cause: unknown) {
    super({
      code: 'resolver.invalid-json',
      message: `Response body for ${url} is not valid JSON.`,
      received: cause instanceof Error ? cause.message : String(cause),
      expected: 'a JSON document',
      cause,
    });
  }
}
