import dns from 'node:dns';

/**
 * SSRF protection: private/reserved IPv4 CIDR ranges.
 */
const PRIVATE_IP_RANGES: Array<{ prefix: number[]; bits: number }> = [
  { prefix: [127, 0, 0, 0], bits: 8 }, // Loopback
  { prefix: [10, 0, 0, 0], bits: 8 }, // Class A private
  { prefix: [172, 16, 0, 0], bits: 12 }, // Class B private
  { prefix: [192, 168, 0, 0], bits: 16 }, // Class C private
  { prefix: [169, 254, 0, 0], bits: 16 }, // Link-local / cloud metadata
  { prefix: [0, 0, 0, 0], bits: 8 }, // Current network
];

function ipv4ToNumber(octets: number[]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const ip = ipv4ToNumber(parts);
  return PRIVATE_IP_RANGES.some(({ prefix, bits }) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ip & mask) === (ipv4ToNumber(prefix) & mask);
  });
}

export function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1') return true;
  // fe80::/10 (link-local)
  if (lower.startsWith('fe80')) {
    const firstSegment = parseInt(lower.split(':')[0], 16);
    if ((firstSegment & 0xffc0) === 0xfe80) return true;
  }
  // ::ffff:<ipv4> (IPv4-mapped IPv6)
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIpv4(v4Mapped[1]);
  return false;
}

/**
 * Resolves a URL's hostname via DNS and rejects private/reserved network addresses.
 *
 * This prevents SSRF attacks where a user-supplied URL could target internal
 * services, cloud metadata endpoints (169.254.169.254), or localhost.
 *
 * @param url - Parsed URL to validate
 * @throws Error with message 'uri must not point to a private or reserved network address'
 */
export async function validatePublicUrl(url: URL): Promise<void> {
  const hostname = url.hostname;

  // Check IP literals directly
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error('uri must not point to a private or reserved network address');
  }

  // Resolve hostname to IP and check
  let resolved: { address: string; family: number };
  try {
    resolved = await dns.promises.lookup(hostname);
  } catch {
    // DNS resolution failure — let the caller's fetch handle the error naturally
    return;
  }

  const isPrivate = resolved.family === 4 ? isPrivateIpv4(resolved.address) : isPrivateIpv6(resolved.address);

  if (isPrivate) {
    throw new Error('uri must not point to a private or reserved network address');
  }
}
