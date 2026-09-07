import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import {
  createSchemaLoader,
  SchemaLoaderError,
  SchemaLoaderHttpError,
  SchemaLoaderInvalidJsonError,
  SchemaLoaderNetworkError,
} from '@uncefact/untp-utils/loaders';
import { NextResponse } from 'next/server';

// The schema route's callers (`schemaURLConstructor` and `VCDM_SCHEMA_URLS` in
// `src/lib/schemaValidation.ts`, `schemeSchemaUrl` in `src/lib/schemeValidation.ts`)
// build URLs pointing at this fixed set of hosts. Allowlisting the initial
// hostname at the route layer closes the `url` query parameter to attacker
// substitution. Redirects are not re-checked against this list; the loader
// below applies the shared `validatePublicUrl` guard to every hop instead
// (public scheme, non-private address, IP-pinned, size, redirect and timeout
// bounds). That guard has no opt-out, so a private or loopback schema host
// cannot be reached through this route even in local development.
const ALLOWED_SCHEMA_HOSTS: ReadonlySet<string> = new Set([
  'untp.unece.org',
  'test.uncefact.org',
  'w3c.github.io',
  'aatp.foodagility.com',
]);

const SCHEMA_CACHE_TTL_MS = 60 * 60 * 1000;
// The allowlist bounds the hosts but not the path space, so the cache is bounded too.
const SCHEMA_CACHE_MAX_ENTRIES = 200;

// One loader per server process: the TTL cache is what dedups concurrent
// fetches of the same schema and serves repeat validations without a network
// round trip, so it has to outlive a single request.
const schemaLoader = createSchemaLoader(
  createInMemoryTtlCache<object>({ ttlMs: SCHEMA_CACHE_TTL_MS, maxEntries: SCHEMA_CACHE_MAX_ENTRIES }),
);

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

  if (parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Schema URL must use https' }, { status: 400 });
  }

  if (!ALLOWED_SCHEMA_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: 'Schema URL host is not on the allowlist' }, { status: 400 });
  }

  const schemaUrl = parsed.toString();

  try {
    const schema = await schemaLoader.load(schemaUrl);
    return NextResponse.json(schema);
  } catch (error) {
    // The loader's typed errors carry the upstream URL and transport detail;
    // that is operator diagnostic, so it goes to the log and the client gets
    // the category. A 502 says the failure was upstream of this route. The
    // loader's own code is `schema-loader.*`; the guard's rejection code
    // (`url.private-address` and siblings) sits on the cause, so both are
    // logged by name and an SSRF rejection is greppable apart from an outage.
    if (error instanceof SchemaLoaderError) {
      const cause = error.cause as { code?: string } | undefined;
      console.error('Schema fetch failed', { url: schemaUrl, code: error.code, causeCode: cause?.code, cause });
    } else {
      console.error('Unexpected schema loader failure', { url: schemaUrl, error });
    }
    if (error instanceof SchemaLoaderHttpError) {
      return NextResponse.json(
        { error: `Schema host returned status ${error.status}`, code: 'upstream-status', upstreamStatus: error.status },
        { status: 502 },
      );
    }
    if (error instanceof SchemaLoaderInvalidJsonError) {
      return NextResponse.json(
        { error: 'Schema host returned a body that is not valid JSON', code: 'invalid-json' },
        { status: 502 },
      );
    }
    if (error instanceof SchemaLoaderNetworkError) {
      // Also covers the guard's rejections and the size, redirect and timeout
      // bounds, so the wording claims only that the load did not complete.
      return NextResponse.json(
        { error: 'The schema could not be loaded from its host', code: 'unreachable' },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: 'Failed to fetch schema' }, { status: 500 });
  }
}
