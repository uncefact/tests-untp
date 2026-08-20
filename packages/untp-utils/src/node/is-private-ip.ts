import { isIPv4, isIPv6 } from 'node:net';
import ipaddr from 'ipaddr.js';

/**
 * The single `ipaddr.js` range category that can represent a publicly
 * routable unicast address. Anything else (loopback, link-local, private,
 * multicast, unique-local, reserved, 6to4, teredo, etc.) is rejected. An
 * allowlist is safer than enumerating disallowed buckets: new range names
 * introduced by future `ipaddr.js` versions default to "block" rather than
 * "allow". For IPv4 this category alone is sufficient (IANA's special-purpose
 * registry is small and enumerated in full); for IPv6 it is not, because
 * `range()` also reports it as a fallback for unallocated space, so
 * {@link isPrivateIpv6} additionally gates on the `2000::/3` Global Unicast
 * block before trusting it.
 */
const PUBLIC_RANGE = 'unicast';

/**
 * Cloud-metadata IPv4 addresses listed explicitly for belt-and-braces
 * coverage. Both addresses are already classified as non-`unicast` by
 * `ipaddr.js` (the AWS / GCP / Azure address via link-local
 * `169.254.0.0/16`, the Alibaba address via CGNAT `100.64.0.0/10`), but the
 * explicit listing means a future change to `ipaddr.js`'s range taxonomy
 * cannot accidentally promote them to `unicast`.
 *
 * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html
 * @see https://help.aliyun.com/document_detail/49122.html
 */
const ADDITIONAL_BLOCKED_IPV4 = new Set(['169.254.169.254', '100.100.100.200']);

/**
 * Hostname suffixes that name resources reachable only on a local network and
 * must not be allowed to leave the host. Matched case-insensitively against
 * the full hostname (e.g. `foo.localhost`, `printer.local`, `db.internal`).
 *
 * `.localhost` is reserved by RFC 6761; `.local` is reserved by RFC 6762
 * (Multicast DNS); `.internal` is on the IANA / ICANN reserved list for
 * private use (per RFC 9499 and ICANN board resolution, 2024); the
 * remainder (`.intranet`, `.lan`, `.home`, `.corp`, `.private`) are
 * widely-used private-network conventions that are blocked from ICANN
 * delegation. Treating them as private is a conservative default for an
 * SSRF guard.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6761 Special-Use Domain Names
 * @see https://datatracker.ietf.org/doc/html/rfc6762 Multicast DNS
 * @see https://datatracker.ietf.org/doc/html/rfc9499 DNS Terminology
 */
const PRIVATE_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.private',
];

/**
 * Returns `true` if `address` is an IPv4 address string that does not fall in
 * the public unicast range, or that matches a known cloud-metadata IP. Use
 * this to gate outbound connections to tenant-supplied addresses.
 *
 * Fails closed: if `ipaddr.js` cannot parse a value that passed
 * `node:net`'s `isIPv4` (parser/grammar skew across versions), the function
 * returns `true` rather than letting the address through.
 *
 * Returns `false` for non-IPv4 input (including unparseable strings).
 * Callers handle parsing themselves and pass only IP literals. Never throws.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc1918 Address Allocation for Private Internets
 * @see https://datatracker.ietf.org/doc/html/rfc6598 IANA-Reserved IPv4 Prefix for Shared Address Space (CGNAT)
 * @see https://datatracker.ietf.org/doc/html/rfc3927 Dynamic Configuration of IPv4 Link-Local Addresses
 * @see https://datatracker.ietf.org/doc/html/rfc5735 Special Use IPv4 Addresses
 */
export function isPrivateIpv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  if (ADDITIONAL_BLOCKED_IPV4.has(address)) return true;
  try {
    return ipaddr.parse(address).range() !== PUBLIC_RANGE;
  } catch {
    return true; // Fail closed: cannot prove the address is public, so treat as private.
  }
}

/**
 * Returns `true` if `address` is an IPv6 address string that is not a
 * genuine public Global Unicast address. This is a default-deny predicate:
 * an address is treated as public only when it is both inside the allocated
 * `2000::/3` Global Unicast block and not one of the named special-purpose
 * ranges within it; every other address, including reserved or unallocated
 * space `ipaddr.js` has no name for, is denied. IPv4-mapped addresses
 * (`::ffff:a.b.c.d`) are re-checked against {@link isPrivateIpv4}, and the
 * deprecated IPv4-compatible form (`::a.b.c.d`) is rejected outright.
 *
 * Fails closed on parser drift, mirroring {@link isPrivateIpv4}.
 *
 * Returns `false` for non-IPv6 input. Never throws.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc4291 IP Version 6 Addressing Architecture
 * @see https://datatracker.ietf.org/doc/html/rfc4193 Unique Local IPv6 Unicast Addresses
 */
export function isPrivateIpv6(address: string): boolean {
  if (!isIPv6(address)) return false;
  // The dotted IPv4-compatible spelling (`::a.b.c.d`) is rewritten by
  // `ipaddr.js` into the IPv4-mapped byte layout before parsing, which would
  // route it to the mapped (accept-if-public) branch below instead of the
  // compatible (always-deny) branch. Deny the textual form up front so both
  // spellings of the deprecated compatible form classify identically.
  // The optional %zone suffix mirrors ipaddr.js's own deprecatedTransitional
  // grammar; without it, a zone-indexed spelling (`::a.b.c.d%eth0`) would
  // still reach the rewrite.
  if (/^::\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(%[0-9a-z]+)?$/i.test(address)) return true;
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
    // - IPv4-mapped (`::ffff:a.b.c.d`) is a real IPv4 destination tunnelled
    //   through IPv6, so the embedded address is re-checked against
    //   {@link isPrivateIpv4} and accepted if public.
    // - IPv4-compatible (`::a.b.c.d`, RFC 4291 section 2.5.5.1) is
    //   deprecated, IANA-reserved space that does not route, so it is
    //   rejected unconditionally regardless of the embedded address (the
    //   dotted spelling is denied textually above, before `ipaddr.js`
    //   rewrites it to the mapped layout). This
    //   also covers `::` (unspecified) and `::1` (loopback), which take
    //   this same form.
    const embedsIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === bytes[11];
    if (embedsIpv4 && bytes[10] === 0xff) {
      return isPrivateIpv4(bytes.slice(12).join('.'));
    }
    if (embedsIpv4 && bytes[10] === 0x00) {
      return true;
    }

    // `3ffe::/16` is the decommissioned 6bone experimental block: it sits
    // inside `2000::/3` (top byte `0x3f`) so the Global Unicast gate below
    // would otherwise let it through, and `ipaddr.js` has no named range
    // for it, so `range()` reports the 'unicast' fallback for it too. It is
    // IANA-reserved and does not route; deny it explicitly.
    if (bytes[0] === 0x3f && bytes[1] === 0xfe) {
      return true;
    }

    // Default-deny: `range()` reports the 'unicast' fallback for any
    // address matching none of `ipaddr.js`'s named special ranges, so it is
    // not by itself a positive "allocated and routable" signal. `4000::1`,
    // `fe00::1`, and `101::1` are all unallocated or IANA-reserved space,
    // and all report `range() === 'unicast'`, so treating that alone as
    // "public" fails open. Requiring the address to also fall inside the
    // allocated Global Unicast block `2000::/3` (top 3 bits `001`) closes
    // that gap while `range()` still excludes the named special-purpose
    // ranges nested inside that block (documentation `2001:db8::/32`,
    // teredo `2001::/32`, 6to4 `2002::/16`, benchmarking `2001:2::/48`).
    //
    // This is not a claim of complete IANA-allocation tracking: it denies
    // everything outside `2000::/3`, everything `ipaddr.js` special-cases
    // within it, and the explicitly-listed `3ffe::/16` above. It does not
    // enumerate every IANA reservation inside `2000::/3` and cannot prove
    // an address is *currently* routed.
    const isAllocatedGlobalUnicast = (bytes[0] & 0xe0) === 0x20;
    return !(isAllocatedGlobalUnicast && v6.range() === PUBLIC_RANGE);
  } catch {
    return true; // Fail closed: cannot prove the address is public, so treat as private.
  }
}

/**
 * Returns `true` if `host` always names a local resource (`localhost`,
 * anything under `.localhost`, `.local`, `.internal`, etc.) or an IP literal
 * in a non-public range.
 *
 * The empty string is treated as private (a URL with no hostname must never
 * be allowed out).
 */
export function isPrivateHostname(host: string): boolean {
  if (!host) return true;
  // Strip leading/trailing brackets (URL.hostname wraps IPv6 literals like
  // `[::1]`) and any trailing dot before further checks; without this, a
  // direct caller passing `URL.hostname` for an IPv6 URL would silently
  // miss the private-range match.
  const lower = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (lower === 'localhost') return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  if (isIPv4(lower)) return isPrivateIpv4(lower);
  if (isIPv6(lower)) return isPrivateIpv6(lower);
  return false;
}
