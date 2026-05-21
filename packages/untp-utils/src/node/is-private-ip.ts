import { isIPv4, isIPv6 } from 'node:net';
import ipaddr from 'ipaddr.js';

/**
 * The single `ipaddr.js` range category that represents a publicly routable
 * unicast address. Anything else (loopback, link-local, private, multicast,
 * unique-local, reserved, 6to4, teredo, etc.) is rejected. An allowlist is
 * safer than enumerating disallowed buckets: new range names introduced by
 * future `ipaddr.js` versions default to "block" rather than "allow".
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
 * Returns `true` if `address` is an IPv6 address string that does not fall in
 * the public unicast range. IPv4-mapped addresses (`::ffff:a.b.c.d`) are
 * additionally re-checked against {@link isPrivateIpv4} so an IPv4 private
 * address tunnelled as IPv6 cannot bypass the predicate.
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
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() !== 'ipv6') return true; // Defensive: parser/version skew. Fail closed.
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return isPrivateIpv4(v6.toIPv4Address().toString());
    }
    return v6.range() !== PUBLIC_RANGE;
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
  const lower = host.toLowerCase().replace(/\.$/, '');
  if (lower === 'localhost') return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  if (isIPv4(lower)) return isPrivateIpv4(lower);
  if (isIPv6(lower)) return isPrivateIpv6(lower);
  return false;
}
