import { NextResponse } from 'next/server';

// Hostnames that resolve to private, loopback, link-local, or otherwise
// internal network addresses. Blocking them before issuing the fetch is
// the minimum SSRF mitigation we need: the schema endpoint takes a URL
// from the client and proxies the fetch, so without this guard it can
// be used to probe internal services from inside the deployment
// network.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./, // link-local
  /^0\./,
  /^\[?::1\]?$/, // IPv6 loopback
  /^\[?fc/i, // IPv6 ULA fc00::/7
  /^\[?fd/i,
  /^\[?fe80/i, // IPv6 link-local
];

const ALLOW_PRIVATE_URLS = process.env.PLAYGROUND_ALLOW_PRIVATE_URLS === 'true';

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(hostname));
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

  if (!ALLOW_PRIVATE_URLS && isPrivateHost(parsed.hostname)) {
    return NextResponse.json({ error: 'Schema URL must not point to a private or loopback address' }, { status: 400 });
  }

  try {
    const response = await fetch(parsed.toString());
    const schema = await response.json();
    return NextResponse.json(schema);
  } catch (error) {
    console.log('Error fetching schema:', error);
    return NextResponse.json({ error: 'Failed to fetch schema' }, { status: 500 });
  }
}
