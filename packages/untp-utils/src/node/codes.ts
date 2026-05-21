/**
 * Validation error codes for `@uncefact/untp-utils/node`.
 *
 * Thing-oriented and namespaced per ADR-034: the namespace identifies what
 * the code is *about* (a URL, a hostname, a resolved address), not the
 * activity that detected it. Stable; consumers may branch on them with
 * exhaustive switches.
 */
export const NodeUrlValidationCode = {
  /** The string could not be parsed as a URL. */
  InvalidUrl: 'url.invalid',
  /** The URL scheme is not in the allowed list (default: `http:`, `https:`). */
  UnsupportedScheme: 'url.unsupported-scheme',
  /** The URL has no hostname, or the hostname is a known private/loopback name (e.g. `localhost`, `*.local`, `*.internal`). */
  PrivateHostname: 'url.private-hostname',
  /** DNS resolution failed for the URL's hostname (resolver rejected the query, e.g. `ENOTFOUND`, `EAI_AGAIN`). */
  ResolutionFailed: 'url.resolution-failed',
  /** DNS resolution succeeded but returned no addresses for the URL's hostname. */
  ResolutionEmpty: 'url.resolution-empty',
  /** The hostname resolved to a private / loopback / link-local / cloud-metadata IP address. */
  PrivateAddress: 'url.private-address',
} as const;

export type NodeUrlValidationCode = (typeof NodeUrlValidationCode)[keyof typeof NodeUrlValidationCode];
