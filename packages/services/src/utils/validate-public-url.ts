import dns from 'node:dns';
import { isIP, isIPv4, isIPv6 } from 'node:net';
import ipaddr from 'ipaddr.js';

/**
 * The `ipaddr.js` range name its special-range matcher (`subnetMatch`)
 * reports for an address that matches none of its named special ranges.
 * This is a FALLBACK DEFAULT (`subnetMatch`'s own `defaultName` parameter
 * defaults to `'unicast'`), not a positive "this address is allocated and
 * globally routable" signal: an address in unallocated or reserved space
 * that `ipaddr.js` has no named range for reports `'unicast'` exactly like
 * a genuine public address does.
 *
 * For {@link isPrivateIpv4} this is safe to rely on alone: IANA's IPv4
 * special-purpose registry is small and `ipaddr.js` enumerates it in full,
 * so nothing outside that registry is left unaccounted for. For
 * {@link isPrivateIpv6} it is not safe alone, because the unallocated
 * reserved space above the Global Unicast block is vast and largely
 * unenumerated by `ipaddr.js`; that predicate additionally gates on the
 * allocated `2000::/3` block before trusting this value.
 */
const PUBLIC_RANGE = 'unicast';

/**
 * SSRF protection: returns true if `address` is an IPv4 address string that
 * does not fall in the public unicast range. This covers RFC1918 private
 * space, loopback, link-local/cloud-metadata (169.254.0.0/16), carrier-grade
 * NAT, and the IANA-reserved documentation, benchmarking, multicast and
 * reserved ranges.
 *
 * Fails closed: if `ipaddr.js` cannot parse a value that `node:net`'s
 * `isIPv4` already accepted (parser/grammar skew across versions), the
 * address is treated as private.
 *
 * Returns false for non-IPv4 input (including unparseable strings); callers
 * are expected to have already established the string is an IPv4 literal.
 */
export function isPrivateIpv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  try {
    return ipaddr.parse(address).range() !== PUBLIC_RANGE;
  } catch {
    return true;
  }
}

/**
 * SSRF protection: returns true if `address` is an IPv6 address string that
 * is not a genuine public Global Unicast address. This is a default-deny
 * predicate: an address is treated as public only when it is both inside
 * the allocated `2000::/3` Global Unicast block and not one of the named
 * special-purpose ranges within it (documentation, teredo, 6to4,
 * benchmarking); every other address, including reserved or unallocated
 * space `ipaddr.js` has no name for, is denied. See the block comment
 * inside for why a bare `range() === 'unicast'` check is not sufficient.
 *
 * Addresses that embed an IPv4 address are handled before the Global
 * Unicast check, and the two embedded forms are NOT treated the same:
 * - IPv4-mapped (`::ffff:a.b.c.d`) is a real IPv4 destination tunnelled
 *   through IPv6, so the embedded address is re-checked against
 *   {@link isPrivateIpv4} and accepted if public.
 * - IPv4-compatible (`::a.b.c.d`, RFC 4291 §2.5.5.1) is deprecated,
 *   IANA-reserved space that does not route, so it is rejected
 *   unconditionally regardless of the embedded address. This also covers
 *   `::` (unspecified) and `::1` (loopback), which take this same form.
 *
 * Fails closed on a parse error, mirroring {@link isPrivateIpv4}.
 *
 * Returns false for non-IPv6 input.
 */
export function isPrivateIpv6(address: string): boolean {
  if (!isIPv6(address)) return false;
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() !== 'ipv6') return true; // Defensive: parser/version skew. Fail closed.
    const v6 = parsed as ipaddr.IPv6;
    const bytes = v6.toByteArray();

    // Both embedded-IPv4 forms encode the IPv4 address in the last 4 bytes
    // with the first 10 bytes zero, differing only in bytes 10-11 (0x0000
    // for IPv4-compatible, 0xffff for IPv4-mapped). Extracting directly from
    // the byte array, rather than trusting `::ffff:` textual matching or
    // `isIPv4MappedAddress()` (which recognises only the mapped form), means
    // neither encoding can bypass classification through this predicate.
    const embedsIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === bytes[11];
    if (embedsIpv4 && bytes[10] === 0xff) {
      return isPrivateIpv4(bytes.slice(12).join('.'));
    }
    if (embedsIpv4 && bytes[10] === 0x00) {
      return true;
    }

    // `3ffe::/16` is the decommissioned 6bone experimental block: it sits
    // inside `2000::/3` (top byte `0x3f`) so the Global Unicast gate below
    // would otherwise let it through, and `ipaddr.js` 2.4.0 has no named
    // range for it, so `range()` reports the 'unicast' fallback for it too.
    // It is IANA-reserved and does not route; deny it explicitly.
    if (bytes[0] === 0x3f && bytes[1] === 0xfe) {
      return true;
    }

    // Default-deny: `range()` reports `PUBLIC_RANGE` ('unicast') for any
    // address matching none of `ipaddr.js`'s named special ranges (see the
    // comment on `PUBLIC_RANGE`), so it is not by itself a positive
    // "allocated and routable" signal. `4000::1`, `fe00::1`, and `101::1`
    // are all unallocated or IANA-reserved space, and all report
    // `range() === 'unicast'`, so treating that alone as "public" fails
    // open. Requiring the address to also fall inside the allocated Global
    // Unicast block `2000::/3` (top 3 bits `001`) closes that gap while
    // `range()` still excludes the named special-purpose ranges nested
    // inside that block (documentation `2001:db8::/32`, teredo
    // `2001::/32`, 6to4 `2002::/16`, benchmarking `2001:2::/48`).
    //
    // This is not a claim of complete IANA-allocation tracking: it denies
    // everything outside `2000::/3`, everything `ipaddr.js` special-cases
    // within it, and the explicitly-listed `3ffe::/16` above. It does not
    // enumerate every IANA reservation inside `2000::/3` and cannot prove an
    // address is *currently* routed; a maintained IANA-allocation layer
    // would be needed for that and is out of scope for this predicate.
    const isAllocatedGlobalUnicast = (bytes[0] & 0xe0) === 0x20;
    return !(isAllocatedGlobalUnicast && v6.range() === PUBLIC_RANGE);
  } catch {
    return true;
  }
}

/**
 * Strips the brackets `URL.hostname` wraps around an IPv6 literal (e.g.
 * `[::1]` becomes `::1`) so the value can be passed to `node:net`'s
 * `isIPv4`/`isIPv6`, to the predicates above, and to DNS resolution.
 * Non-bracketed hostnames pass through unchanged.
 */
function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '');
}

/**
 * Resolves a URL's hostname via DNS and rejects private/reserved network addresses.
 *
 * This prevents SSRF attacks where a user-supplied URL could target internal
 * services, cloud metadata endpoints (169.254.169.254), or localhost.
 *
 * DNS resolution is performed with `{ all: true }`; the URL is rejected if
 * any resolved address is private, so a hostname that resolves to a mix of
 * public and private addresses cannot pass on the strength of whichever
 * record the resolver happened to prefer.
 *
 * @param url - Parsed URL to validate
 * @throws Error with message 'uri must not point to a private or reserved network address'
 * @throws Error with message 'uri hostname could not be resolved'
 */
export async function validatePublicUrl(url: URL): Promise<void> {
  const hostname = stripIpv6Brackets(url.hostname);

  // IP literals are checked directly and never reach DNS: a private literal
  // is rejected without leaking a lookup, and a public literal is the
  // resolved address already, so resolving it again would be redundant.
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
      throw new Error('uri must not point to a private or reserved network address');
    }
    return;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.promises.lookup(hostname, { all: true });
  } catch (cause) {
    throw new Error('uri hostname could not be resolved', { cause });
  }

  // An empty result is not an absence of a private address: `[].some(...)`
  // below is `false`, so without this guard a hostname the resolver
  // reports as having no records at all would be treated as safe to reach.
  if (resolved.length === 0) {
    throw new Error('uri hostname could not be resolved');
  }

  // Derive each record's family from the address string itself rather than
  // trusting `record.family` (typed as a bare `number`, not a 4|6 literal
  // union, and DNS resolvers have shipped bugs that misreport it). Reject
  // outright if the address does not parse as an IP at all, or if the
  // derived family disagrees with what the resolver claimed: contradictory
  // or unparseable metadata is treated as untrustworthy rather than
  // silently reconciled. Only a record whose derived family agrees with its
  // claimed family reaches the matching predicate.
  const isPrivate = resolved.some((record) => {
    const derivedFamily = isIP(record.address);
    if (derivedFamily === 0 || derivedFamily !== record.family) return true;
    return derivedFamily === 4 ? isPrivateIpv4(record.address) : isPrivateIpv6(record.address);
  });

  if (isPrivate) {
    throw new Error('uri must not point to a private or reserved network address');
  }
}
