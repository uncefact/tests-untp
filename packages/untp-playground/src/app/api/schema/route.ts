import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import {
  createSchemaLoader,
  SchemaLoaderHttpError,
  SchemaLoaderInvalidJsonError,
  SchemaLoaderNetworkError,
} from '@uncefact/untp-utils/loaders';
import { NextResponse } from 'next/server';

// The schema route's only callers (`schemaURLConstructor`, `EXTENSION_VERSIONS`
// and `VCDM_SCHEMA_URLS` in `src/lib/schemaValidation.ts`) build URLs pointing
// at this fixed set of hosts. Allowlisting them at the route layer turns the
// SSRF surface into a closed set: an attacker can substitute the `url` query
// parameter, but it will be rejected unless its hostname is one of these. The
// loader below applies the shared `validatePublicUrl` guard as a second layer
// (public scheme, non-private address, IP-pinned, size and redirect bounds).
//
// For local development against a private or extra host, set
// `PLAYGROUND_ALLOW_PRIVATE_URLS=true`.
const ALLOWED_SCHEMA_HOSTS: ReadonlySet<string> = new Set([
  'untp.unece.org',
  'test.uncefact.org',
  'w3c.github.io',
  'aatp.foodagility.com',
]);

const ALLOW_PRIVATE_URLS = process.env.PLAYGROUND_ALLOW_PRIVATE_URLS === 'true';

const SCHEMA_CACHE_TTL_MS = 60 * 60 * 1000;

// One loader per server process: the TTL cache is what dedups concurrent
// fetches of the same schema and serves repeat validations without a network
// round trip, so it has to outlive a single request.
const schemaLoader = createSchemaLoader(createInMemoryTtlCache<object>({ ttlMs: SCHEMA_CACHE_TTL_MS }));

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
    const schema = await schemaLoader.load(parsed.toString());
    return NextResponse.json(schema);
  } catch (error) {
    // The loader's typed errors carry the upstream URL and transport detail;
    // that is operator diagnostic, so it goes to the log and the client gets
    // the category. A 502 says the failure was upstream of this route.
    console.error('Error fetching schema:', error);
    if (error instanceof SchemaLoaderHttpError) {
      return NextResponse.json(
        { error: `Schema host returned status ${error.status}`, upstreamStatus: error.status },
        { status: 502 },
      );
    }
    if (error instanceof SchemaLoaderInvalidJsonError) {
      return NextResponse.json({ error: 'Schema host returned a body that is not valid JSON' }, { status: 502 });
    }
    if (error instanceof SchemaLoaderNetworkError) {
      return NextResponse.json({ error: 'Schema host could not be reached' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Failed to fetch schema' }, { status: 500 });
  }
}
