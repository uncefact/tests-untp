import { NextResponse } from 'next/server';

// The schema route's only callers (`schemaURLConstructor` and
// `VCDM_SCHEMA_URLS` in `src/lib/schemaValidation.ts`) build URLs
// pointing at this fixed set of hosts. Allowlisting them at the
// route layer turns the SSRF surface into a closed set: an attacker
// can substitute the `url` query parameter, but it will be rejected
// unless its hostname is one of these.
//
// For local development against a private or extra host, set
// `PLAYGROUND_ALLOW_PRIVATE_URLS=true`.
const ALLOWED_SCHEMA_HOSTS: ReadonlySet<string> = new Set(['untp.unece.org', 'test.uncefact.org', 'w3c.github.io']);

const ALLOW_PRIVATE_URLS = process.env.PLAYGROUND_ALLOW_PRIVATE_URLS === 'true';

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

  if (!ALLOW_PRIVATE_URLS && !ALLOWED_SCHEMA_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: 'Schema URL host is not on the allowlist' }, { status: 400 });
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
