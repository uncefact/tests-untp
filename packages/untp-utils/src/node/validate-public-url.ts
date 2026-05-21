import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { ParseOutcome, ValidationError } from '../validation-outcome.js';
import { isPrivateHostname, isPrivateIpv4, isPrivateIpv6 } from './is-private-ip.js';
import { NodeUrlValidationCode } from './codes.js';

/**
 * Options for {@link validatePublicUrl}.
 */
export interface ValidatePublicUrlOptions {
  /**
   * URL schemes that are allowed. Compared case-insensitively against the
   * scheme parsed by `URL`, which always includes the trailing colon
   * (e.g. `http:`, `https:`). The template literal type enforces the
   * trailing colon at compile time. Defaults to `['http:', 'https:']`.
   */
  allowedSchemes?: readonly `${string}:`[];
  /**
   * IP family hint passed to `dns.lookup`. `0` (default) returns whichever
   * family the resolver prefers, `4` forces IPv4-only, `6` forces IPv6-only.
   */
  family?: 0 | 4 | 6;
}

/**
 * The resolved address that callers must use when actually connecting, so
 * the connection target matches the address that {@link validatePublicUrl}
 * checked. Connecting via the hostname instead allows DNS rebinding: a
 * subsequent resolution can return a different (and private) IP.
 */
export interface ValidatePublicUrlValue {
  /** The hostname's resolved IP address (an IPv4 or IPv6 literal). */
  address: string;
  /** Address family of {@link address}. */
  family: 4 | 6;
}

/**
 * Outcome of validating a URL for outbound use, per ADR-034. `value` is
 * present iff `errors.length === 0`.
 */
export type ValidatePublicUrlOutcome = ParseOutcome<ValidatePublicUrlValue>;

const DEFAULT_ALLOWED_SCHEMES: readonly `${string}:`[] = ['http:', 'https:'];

/**
 * Validates that `url` is a parseable HTTP(S) URL whose hostname resolves to
 * publicly routable IP addresses, and returns one of those resolved
 * addresses so the caller can connect to that exact IP. Resolving and
 * connecting in two separate steps would open a DNS rebinding window;
 * consumers must use `outcome.value.address` as the connection target.
 *
 * DNS resolution is performed with `all: true`, so every A and AAAA record
 * is inspected. The URL is rejected if *any* resolved address is in a
 * private / loopback / link-local / cloud-metadata range. This prevents a
 * mixed public/private DNS response from sneaking a private record past
 * the check.
 *
 * Per ADR-034, this function does not throw for input-related failures.
 * Parse failures, scheme mismatches, private hostnames, resolution
 * failures, and private resolved addresses all surface as entries in
 * `errors[]`.
 *
 * @see https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 */
export async function validatePublicUrl(
  url: string,
  options?: ValidatePublicUrlOptions,
): Promise<ValidatePublicUrlOutcome> {
  const errors: ValidationError[] = [];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    errors.push({
      code: NodeUrlValidationCode.InvalidUrl,
      message: 'URL could not be parsed.',
      received: url,
      raw: error,
    });
    return { errors, warnings: [] };
  }

  const allowedSchemes = options?.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  const scheme = parsed.protocol.toLowerCase();
  if (!allowedSchemes.some((s) => s.toLowerCase() === scheme)) {
    errors.push({
      code: NodeUrlValidationCode.UnsupportedScheme,
      message: `URL scheme ${scheme} is not in the allowed list.`,
      received: scheme,
      expected: [...allowedSchemes],
    });
    return { errors, warnings: [] };
  }

  // URL.hostname wraps IPv6 literals in brackets (e.g. `[::1]`); strip them
  // so the hostname can be passed to predicates and DNS resolution. Note
  // that `URL` already discards any `userinfo@` prefix from the hostname,
  // so smuggling attempts like `http://evil.com@127.0.0.1/` resolve to
  // `127.0.0.1` and are caught by isPrivateHostname below.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHostname(hostname)) {
    errors.push({
      code: NodeUrlValidationCode.PrivateHostname,
      message: `Hostname ${hostname || '(empty)'} names a private or local resource.`,
      received: hostname,
    });
    return { errors, warnings: [] };
  }

  // If the hostname is already an IP literal, skip DNS resolution; the
  // literal itself is the resolved address, and the private-range check
  // above (via isPrivateHostname) has already validated it.
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return { value: { address: hostname, family: literalFamily }, errors: [], warnings: [] };
  }

  let records: { address: string; family: number }[];
  try {
    records = await dnsLookup(hostname, { family: options?.family ?? 0, all: true });
  } catch (error) {
    errors.push({
      code: NodeUrlValidationCode.ResolutionFailed,
      message: `DNS resolution failed for ${hostname}.`,
      received: error instanceof Error ? error.message : String(error),
      raw: error,
    });
    return { errors, warnings: [] };
  }

  if (records.length === 0) {
    errors.push({
      code: NodeUrlValidationCode.ResolutionEmpty,
      message: `DNS resolver returned no addresses for ${hostname}.`,
      received: hostname,
    });
    return { errors, warnings: [] };
  }

  const publicRecords: { address: string; family: 4 | 6 }[] = [];
  const privateRecords: string[] = [];
  for (const record of records) {
    if (record.family !== 4 && record.family !== 6) {
      errors.push({
        code: NodeUrlValidationCode.ResolutionFailed,
        message: `DNS resolver returned an unsupported address family ${record.family} for ${hostname}.`,
        received: { address: record.address, family: record.family },
        expected: 'family 4 or 6',
      });
      return { errors, warnings: [] };
    }
    const isPrivate = record.family === 4 ? isPrivateIpv4(record.address) : isPrivateIpv6(record.address);
    if (isPrivate) {
      privateRecords.push(record.address);
    } else {
      publicRecords.push({ address: record.address, family: record.family });
    }
  }

  // Reject if *any* resolved record is private. A hostname with mixed
  // public/private A or AAAA records must not be allowed through: the
  // consumer's connect call could pick the private one.
  if (privateRecords.length > 0) {
    errors.push({
      code: NodeUrlValidationCode.PrivateAddress,
      message: `Hostname ${hostname} resolved to a private address.`,
      received: privateRecords,
    });
    return { errors, warnings: [] };
  }

  // All records are public; pin the first one as the connect target. The
  // first matches what a default single-address `dns.lookup` would have
  // returned, so the choice is predictable for consumers.
  const pinned = publicRecords[0];
  return {
    value: { address: pinned.address, family: pinned.family },
    errors: [],
    warnings: [],
  };
}
