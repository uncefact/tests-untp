/**
 * Validation error codes for `@uncefact/untp-utils/resolvers`.
 *
 * Thing-oriented and namespaced per ADR-034: the namespace identifies what
 * the code is *about* (a resolver-side fetch step), not the activity that
 * detected it. Stable; consumers may branch on them with exhaustive
 * switches.
 *
 * URL-shape failures (invalid URL, unsupported scheme, private hostname,
 * resolution failure, private resolved address) surface under
 * {@link import('../node/codes.js').NodeUrlValidationCode} from the
 * underlying `validatePublicUrl` call; consumers see both namespaces in
 * the outcome's `errors[]`.
 */
export const ResolverCode = {
  /** The fetch call rejected before producing a response (TCP/TLS error, DNS race, etc.). */
  NetworkError: 'resolver.network-error',
  /** The remote returned a non-success HTTP status (>=400, or unhandled 1xx/3xx). */
  HttpError: 'resolver.http-error',
  /** The response body exceeded the configured size cap. */
  TooLarge: 'resolver.too-large',
  /** A redirect chain exceeded the configured maximum hop count. */
  TooManyRedirects: 'resolver.too-many-redirects',
  /** The fetch was aborted by the timeout signal. */
  TimedOut: 'resolver.timed-out',
  /** A 3xx response was received without a usable `Location` header. */
  RedirectMissingLocation: 'resolver.redirect-missing-location',
} as const;

export type ResolverCode = (typeof ResolverCode)[keyof typeof ResolverCode];
