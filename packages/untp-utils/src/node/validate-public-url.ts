import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isPrivateHostname, isPrivateIpv4, isPrivateIpv6 } from './is-private-ip.js';
import {
  InvalidUrlError,
  PrivateAddressError,
  PrivateHostnameError,
  ResolutionEmptyError,
  ResolutionFailedError,
  UnsupportedSchemeError,
} from './errors.js';

/**
 * Options for {@link validatePublicUrl}.
 */
export interface ValidatePublicUrlOptions {
  /**
   * URL schemes that are allowed (e.g. `['http', 'https']`). Compared
   * case-insensitively. Defaults to `['http', 'https']`.
   */
  allowedSchemes?: readonly string[];
  /**
   * IP family hint passed to `dns.lookup`. `0` (default) returns whichever
   * family the resolver prefers, `4` forces IPv4-only, `6` forces IPv6-only.
   */
  family?: 0 | 4 | 6;
}

/**
 * The resolved address that callers must use as the connect target so the
 * connection lands on the IP that validation checked. Connecting via the
 * hostname instead opens a DNS rebinding window.
 */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

const DEFAULT_ALLOWED_SCHEMES: readonly string[] = ['http', 'https'];

/**
 * Validates that `url` is a parseable HTTP(S) URL whose hostname resolves
 * to publicly routable IP addresses, and returns one of those addresses
 * pinned for the caller to use as the connect target.
 *
 * DNS resolution is performed with `all: true`; the URL is rejected if any
 * resolved address is in a private / loopback / link-local /
 * cloud-metadata range, so a mixed public/private DNS response cannot
 * sneak a private record through.
 *
 * Per ADR-035, this function throws subclasses of {@link UrlValidationError}
 * on failure. The structured payload (`code`, `message`, `received`,
 * `expected`, `remediation`, `pointer`, `cause`) is available on the thrown
 * instance.
 *
 * @see https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 * @see ../../../docs/adrs/035-utils-throws-structured-errors.md
 * @throws {InvalidUrlError} `url` is not a parseable URL.
 * @throws {UnsupportedSchemeError} the URL's scheme is not allowed.
 * @throws {PrivateHostnameError} the hostname names a private resource.
 * @throws {ResolutionFailedError} DNS resolution rejected, or the resolver returned an unparseable or family-contradictory record.
 * @throws {ResolutionEmptyError} DNS resolution returned no records.
 * @throws {PrivateAddressError} any resolved record is private.
 */
export async function validatePublicUrl(url: string, options?: ValidatePublicUrlOptions): Promise<ResolvedAddress> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new InvalidUrlError(url, cause);
  }

  const allowedSchemes = options?.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  const scheme = parsed.protocol.toLowerCase().replace(/:$/, '');
  if (!allowedSchemes.some((s) => s.toLowerCase() === scheme)) {
    throw new UnsupportedSchemeError(scheme, allowedSchemes);
  }

  // URL.hostname wraps IPv6 literals in brackets (e.g. `[::1]`); strip them
  // so the hostname can be passed to predicates and DNS resolution. Note
  // that `URL` already discards any `userinfo@` prefix from the hostname,
  // so smuggling attempts like `http://evil.com@127.0.0.1/` resolve to
  // `127.0.0.1` and are caught by isPrivateHostname below.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHostname(hostname)) {
    throw new PrivateHostnameError(hostname);
  }

  // If the hostname is already an IP literal, skip DNS resolution; the
  // literal itself is the resolved address, and the private-range check
  // above (via isPrivateHostname) has already validated it.
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: hostname, family: literalFamily };
  }

  let records: { address: string; family: number }[];
  try {
    records = await dnsLookup(hostname, { family: options?.family ?? 0, all: true });
  } catch (cause) {
    throw new ResolutionFailedError(hostname, cause);
  }

  if (records.length === 0) {
    throw new ResolutionEmptyError(hostname);
  }

  const privateRecords: string[] = [];
  let firstPublicRecord: ResolvedAddress | null = null;
  for (const record of records) {
    // Derive the record's family from the address string itself rather than
    // trusting `record.family` (typed as a bare `number`, and DNS resolvers
    // have shipped bugs that misreport it). A record whose address does not
    // parse as an IP at all, or whose derived family disagrees with the
    // resolver's claim, is contradictory metadata and is rejected outright
    // rather than silently reconciled.
    const derivedFamily = isIP(record.address);
    if ((derivedFamily !== 4 && derivedFamily !== 6) || derivedFamily !== record.family) {
      throw new ResolutionFailedError(
        hostname,
        new Error(
          `resolver returned a contradictory or unparseable record: ${record.address} (family ${record.family})`,
        ),
      );
    }
    const isPrivate = derivedFamily === 4 ? isPrivateIpv4(record.address) : isPrivateIpv6(record.address);
    if (isPrivate) {
      privateRecords.push(record.address);
    } else if (!firstPublicRecord) {
      firstPublicRecord = { address: record.address, family: derivedFamily };
    }
  }

  if (privateRecords.length > 0) {
    throw new PrivateAddressError(hostname, privateRecords);
  }

  // Defensive: `records.length > 0` and `privateRecords.length === 0`
  // implies a public record was assigned in the loop. Throwing rather
  // than `!`-asserting keeps the invariant explicit at the boundary.
  if (!firstPublicRecord) {
    throw new ResolutionEmptyError(hostname);
  }
  return firstPublicRecord;
}
