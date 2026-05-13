import { lookup } from 'node:dns/promises';
import { NextResponse } from 'next/server';

// IP-shaped patterns anchored to a full hostname. Used twice: against
// `URL.hostname` (which normalises IP literals) and against the
// addresses returned by `dns.lookup`. Hostname-string patterns that
// only check a prefix (e.g. `/^10\./`) would have false-positive on
// real public domains like `10.example.com`.
const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^127(?:\.\d+){3}$/,
  /^10(?:\.\d+){3}$/,
  /^192\.168(?:\.\d+){2}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}$/,
  /^169\.254(?:\.\d+){2}$/,
  /^0(?:\.\d+){3}$/,
  /^::1$/,
  /^(?:fc|fd)[0-9a-f:]+$/i, // IPv6 ULA fc00::/7
  /^fe80[0-9a-f:]*$/i, // IPv6 link-local
];

// Hostnames that never name a public host even before DNS resolution.
const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [/^localhost$/i];

const ALLOW_PRIVATE_URLS = process.env.PLAYGROUND_ALLOW_PRIVATE_URLS === 'true';

function isPrivateLiteral(value: string): boolean {
  return PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(value)) || PRIVATE_IP_PATTERNS.some((re) => re.test(value));
}

/**
 * Resolve the hostname and reject if any returned address is private.
 *
 * This is best-effort: a DNS-rebinding attacker can return a public
 * address here and a private address on the subsequent `fetch`. For
 * stronger guarantees the resolved IP would need to be passed back
 * into the connect path, which is out of scope for a Next.js route.
 * The redirect ban below blocks the most common practical bypass.
 */
async function rejectIfPrivateHost(hostname: string): Promise<NextResponse | null> {
  if (isPrivateLiteral(hostname)) {
    return NextResponse.json({ error: 'Schema URL must not point to a private or loopback address' }, { status: 400 });
  }
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateLiteral(address)) {
        return NextResponse.json(
          { error: 'Schema URL must not point to a private or loopback address' },
          { status: 400 },
        );
      }
    }
  } catch {
    return NextResponse.json({ error: 'Schema URL hostname could not be resolved' }, { status: 400 });
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'No schema URL provided' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid schema URL' }, { status: 400 });
  }

  if (parsed.protocol !== 'https:' && !(ALLOW_PRIVATE_URLS && parsed.protocol === 'http:')) {
    return NextResponse.json({ error: 'Schema URL must use https' }, { status: 400 });
  }

  if (!ALLOW_PRIVATE_URLS) {
    const rejection = await rejectIfPrivateHost(parsed.hostname);
    if (rejection) return rejection;
  }

  try {
    // `redirect: 'manual'` keeps `fetch` from auto-following a redirect
    // to a private IP that a public host might issue (the second arm of
    // the SSRF bypass Gemini flagged). A 3xx response is surfaced as an
    // error to the caller; legitimate schema hosts respond 200 directly.
    const response = await fetch(parsed.toString(), { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json({ error: 'Schema URL redirected; only direct responses are allowed' }, { status: 400 });
    }
    const schema = await response.json();
    return NextResponse.json(schema);
  } catch (error) {
    console.log('Error fetching schema:', error);
    return NextResponse.json({ error: 'Failed to fetch schema' }, { status: 500 });
  }
}
