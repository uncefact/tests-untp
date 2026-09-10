import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
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
  /** Permit private, loopback and reserved hostnames and addresses. Defaults to strict rejection. */
  allowPrivateAddresses?: boolean;
  /**
   * Lookup implementation used for hostname resolution. This is a test and
   * diagnostics seam, not a policy switch: every returned address still goes
   * through the hostname and address guard below. Omitted uses Node's default
   * `node:dns/promises` lookup.
   */
  lookup?: PublicUrlLookup;
}

/** Node lookup result shape used when validating all addresses for a hostname. */
export type PublicUrlLookup = (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>;

/**
 * The resolved address that callers must use as the connect target so the
 * connection lands on the IP that validation checked. Connecting via the
 * hostname instead opens a DNS rebinding window.
 */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * The validated address set for one hostname, in resolver order. Callers must
 * connect only to these addresses, so the connection lands on IPs that
 * validation checked.
 *
 * `address` and `family` repeat the first entry of `addresses`, so a caller
 * that can use only one connect target keeps working unchanged. A caller that
 * can offer several targets to its connector should hand it the whole of
 * `addresses`: a name such as `localhost` resolves to both `::1` and
 * `127.0.0.1`, and only one of them may have a listener, so pinning the first
 * alone refuses a connection an unpinned request would have made.
 */
export interface ValidatedAddresses extends ResolvedAddress {
  addresses: readonly ResolvedAddress[];
}

const DEFAULT_ALLOWED_SCHEMES: readonly string[] = ['http', 'https'];

/**
 * Validates that `url` is a parseable HTTP(S) URL whose hostname resolves
 * to publicly routable IP addresses, and returns the validated address set,
 * pinned by the resolver, for the caller to use as its connect targets. When
 * `allowPrivateAddresses` is exactly `true`, private and reserved destinations
 * are permitted while the other validation and pinning rules remain active.
 *
 * DNS resolution is performed with `all: true`; in strict mode the URL is
 * rejected if any resolved address is in a private / loopback / link-local /
 * cloud-metadata range, so a mixed public/private DNS response cannot sneak a
 * private record through. `addresses` therefore holds every structurally valid
 * record, in resolver order: in strict mode all of them are public, because a
 * private one has already thrown, and in relaxed mode all of them. `address`
 * and `family` repeat the first entry.
 *
 * Per ADR-035, this function throws subclasses of {@link UrlValidationError}
 * on failure. The structured payload (`code`, `message`, `received`,
 * `expected`, `remediation`, `pointer`, `cause`) is available on the thrown
 * instance.
 *
 * @see https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 * @see ../../../docs/adrs/035-utils-throws-structured-errors.md
 * @throws {InvalidUrlError} `url` is not a parseable URL, or has no hostname.
 * @throws {UnsupportedSchemeError} the URL's scheme is not allowed.
 * @throws {PrivateHostnameError} the hostname names a private resource in strict mode.
 * @throws {ResolutionFailedError} DNS resolution rejected, or the resolver returned an unparseable or family-contradictory record.
 * @throws {ResolutionEmptyError} DNS resolution returned no records.
 * @throws {PrivateAddressError} any resolved record is private in strict mode.
 */
export async function validatePublicUrl(url: string, options?: ValidatePublicUrlOptions): Promise<ValidatedAddresses> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new InvalidUrlError(url, cause);
  }

  const allowedSchemes = options?.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  const allowPrivateAddresses = options?.allowPrivateAddresses === true;
  const scheme = parsed.protocol.toLowerCase().replace(/:$/, '');
  if (!allowedSchemes.some((s) => s.toLowerCase() === scheme)) {
    throw new UnsupportedSchemeError(scheme, allowedSchemes);
  }

  // URL.hostname wraps IPv6 literals in brackets (e.g. `[::1]`); strip them
  // so the hostname can be passed to predicates and DNS resolution. Note
  // that `URL` already discards any `userinfo@` prefix from the hostname, so
  // a smuggling attempt like `http://evil.com@127.0.0.1/` is checked and
  // connected as `127.0.0.1`, never as `evil.com`. In strict mode
  // `isPrivateHostname` below then refuses it; in relaxed mode the private
  // test does not run, and the destination is permitted as any other private
  // destination is. Refusing the userinfo itself is not this function's job in
  // either mode: for user-submitted URLs the RI's request schema rejects one
  // that carries userinfo, and undici does not send credentials it was not
  // asked for. URLs this function is given from elsewhere (did:web resolution,
  // for instance) pass through no such schema, so that first clause covers the
  // caller-supplied case only.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  // A URL with no authority is malformed input, not a private destination, so
  // it is reported as an invalid URL in both modes. Refusing it here keeps the
  // function total: with no hostname there is nothing to resolve and nothing to
  // pin, so returning normally would hand the caller an unpinned fetch.
  if (!hostname) {
    throw new InvalidUrlError(url, new Error('URL has no hostname.'));
  }
  if (!allowPrivateAddresses && isPrivateHostname(hostname)) {
    throw new PrivateHostnameError(hostname);
  }

  // If the hostname is already an IP literal, skip DNS resolution: the
  // literal itself is the resolved address, so there is nothing to look up.
  // In strict mode `isPrivateHostname` above has already refused a private
  // literal. In relaxed mode that test did not run, which is the point of the
  // mode: the literal is returned and pinned without a private-range check.
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: hostname, family: literalFamily, addresses: [{ address: hostname, family: literalFamily }] };
  }

  let records: { address: string; family: number }[];
  try {
    const lookup = options?.lookup ?? dnsLookup;
    records = await lookup(hostname, { family: options?.family ?? 0, all: true });
  } catch (cause) {
    throw new ResolutionFailedError(hostname, cause);
  }

  if (records.length === 0) {
    throw new ResolutionEmptyError(hostname);
  }

  const privateRecords: string[] = [];
  const validRecords: ResolvedAddress[] = [];
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
    validRecords.push({ address: record.address, family: derivedFamily });
    if (isPrivate && !allowPrivateAddresses) {
      privateRecords.push(record.address);
    }
  }

  if (!allowPrivateAddresses && privateRecords.length > 0) {
    throw new PrivateAddressError(hostname, privateRecords);
  }

  // Defensive: every record either throws above or is collected, so
  // `records.length > 0` implies `validRecords` is non-empty. That reasoning
  // holds in both modes; the pre-relaxation version reasoned from a public
  // record existing, which is no longer what the loop collects. Throwing
  // rather than `!`-asserting keeps the invariant explicit at the boundary. It
  // throws a plain Error rather than a resolution failure so a defect in this
  // loop can never be classified as a retryable DNS fault by a caller.
  const [first] = validRecords;
  if (!first) {
    throw new Error('validatePublicUrl invariant: no record selected');
  }
  return { address: first.address, family: first.family, addresses: validRecords };
}
