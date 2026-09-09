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

/**
 * The fetch call rejected before producing a response (TCP/TLS error, DNS
 * race, etc.), or the body read rejected after the headers arrived. Rejections
 * that the resolver classifies as this request's timeout are reported as
 * {@link ResolverTimedOutError} instead; every other rejection caught at those
 * two awaits, including a non-abort-shaped one that arrives after the deadline
 * has passed, arrives here.
 */
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

/**
 * The remote returned a non-success HTTP status. `url` is the URL of the hop
 * that produced the status (the end of the redirect chain), exposed so
 * callers can still report on the final URL of a failed resolution.
 */
export class ResolverHttpError extends ResolverError {
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number) {
    super({
      code: 'resolver.http-error',
      message: `${url} returned status ${status}.`,
      received: status,
      expected: '2xx',
    });
    this.status = status;
    this.url = url;
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

/**
 * A redirect chain exceeded the configured maximum hop count. `.lastHopUrl` is
 * optional. The resolver supplies it as the hop that answered the exhausting
 * redirect whenever a chain exhausts a finite non-negative integer
 * `maxRedirects`, which is the supported input. It is absent otherwise: for a
 * negative or non-integer limit, where the loop names no responder, and for a
 * direct two-argument construction, which this constructor permits.
 */
export class ResolverTooManyRedirectsError extends ResolverError {
  readonly limit: number;
  readonly lastHopUrl?: string;
  constructor(startUrl: string, limit: number, lastHopUrl?: string) {
    super({
      code: 'resolver.too-many-redirects',
      message: `Exceeded ${limit} redirect hops starting from ${startUrl}.`,
      received: `> ${limit} hops`,
      expected: `<= ${limit} hops`,
    });
    this.limit = limit;
    if (lastHopUrl !== undefined) this.lastHopUrl = lastHopUrl;
  }
}

/**
 * The request's total deadline expired. That covers expiry while the guard was
 * still waiting on DNS, before any fetch began, as well as a fetch or body read
 * that rejected with an abort-shaped error once this request's signal had
 * fired.
 */
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

/**
 * The response body was fetched but could not be parsed as JSON. `url` is
 * the final URL the body was fetched from (after redirect chasing), exposed
 * so callers can still report on the final URL of a failed resolution.
 */
export class ResolverInvalidJsonError extends ResolverError {
  readonly url: string;
  constructor(url: string, cause: unknown) {
    super({
      code: 'resolver.invalid-json',
      message: `Response body for ${url} is not valid JSON.`,
      received: cause instanceof Error ? cause.message : String(cause),
      expected: 'a JSON document',
      cause,
    });
    this.url = url;
  }
}
