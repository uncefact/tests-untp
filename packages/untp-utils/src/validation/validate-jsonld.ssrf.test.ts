import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateJsonLd } from './validate-jsonld.js';
import { JsonLdExpansionFailedError } from './errors.js';
import { UrlValidationError } from '../node/errors.js';

/**
 * Walks the native `Error.cause` chain from `error`, collecting every link.
 * jsonld.js's own `JsonLdError` buries a document loader's rejection at the
 * non-standard `details.cause` and never sets native `Error.cause`;
 * `validateJsonLd` rehydrates it onto `error.cause` when wrapping an
 * expansion failure (see `validate-jsonld.ts`), so a plain `.cause` walk
 * reaches the SSRF guard's rejection the same way it does on the
 * schema-fetch path (`schema-loader.ssrf.test.ts`).
 */
function nativeCauseChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current instanceof Error && current.cause !== undefined) {
    chain.push(current.cause);
    current = current.cause;
  }
  return chain;
}

/**
 * End-to-end SSRF regression for JSON-LD expansion. Unlike `validate-jsonld.test.ts`,
 * this suite does NOT mock `jsonld` or the resolver stack: it exercises the real
 * `jsonld.toRDF` + guarded document loader against a live loopback server standing
 * in for an internal service.
 *
 * The load-bearing assertion is that the canary server is NEVER contacted. A prior
 * (unguarded) implementation would let jsonld.js's default Node loader fetch a
 * private `@context` URL, hitting the canary. The guard rejects the URL before any
 * connection, so `hits` stays 0 regardless of how the expansion ultimately fails.
 *
 * @see https://github.com/uncefact/tests-untp/issues/707
 */
describe('validateJsonLd SSRF guard (real jsonld + guarded loader)', () => {
  let server: http.Server;
  let baseUrl: string;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits += 1;
      res.setHeader('content-type', 'application/ld+json');
      res.end(JSON.stringify({ '@context': {} }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  beforeEach(() => {
    hits = 0;
  });

  it('never contacts a private @context URL during expansion', async () => {
    const malicious = { '@context': `${baseUrl}/internal-context`, name: 'value' };

    const error = await validateJsonLd(malicious).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JsonLdExpansionFailedError);
    // The rejection came from the SSRF guard, not an unrelated expansion failure.
    expect(nativeCauseChain(error)).toContainEqual(expect.any(UrlValidationError));
    // The security property: the loopback canary was never reached.
    expect(hits).toBe(0);
  });

  it('rejects a metadata-service @context literal before any connection', async () => {
    const malicious = { '@context': 'http://169.254.169.254/latest/meta-data', name: 'value' };

    const error = await validateJsonLd(malicious).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JsonLdExpansionFailedError);
    expect(nativeCauseChain(error)).toContainEqual(expect.any(UrlValidationError));
  });

  it('expands a document with an inline @context without any network fetch', async () => {
    const document = { '@context': { name: 'http://schema.org/name' }, name: 'Acme' };

    await expect(validateJsonLd(document)).resolves.toBeUndefined();
    expect(hits).toBe(0);
  });

  it('reaches the UrlValidationError by plain .cause hops, matching the schema-fetch path shape', async () => {
    const malicious = { '@context': `${baseUrl}/internal-context`, name: 'value' };

    const error = (await validateJsonLd(malicious).catch((e: unknown) => e)) as JsonLdExpansionFailedError;

    // First hop: jsonld.js's own JsonLdError (still carries `.details` for
    // callers that want the raw jsonld diagnostic).
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).name).toBe('jsonld.InvalidUrl');
    // Second hop: the guard's rejection itself, reachable without digging
    // into jsonld.js's proprietary `details.cause`.
    expect((error.cause as Error).cause).toBeInstanceOf(UrlValidationError);
  });

  it('never contacts a private scoped (term-level) @context URL during expansion', async () => {
    // A term can declare its own remote @context (JSON-LD 1.1 scoped contexts).
    // jsonld.js resolves it through the same guarded loader as a top-level
    // @context, so it must be rejected the same way.
    const malicious = {
      '@context': { myTerm: { '@id': 'http://schema.org/myTerm', '@context': `${baseUrl}/internal-scoped-context` } },
      myTerm: 'value',
    };

    const error = await validateJsonLd(malicious).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JsonLdExpansionFailedError);
    // The rejection came from the SSRF guard, reachable by plain .cause hops.
    // jsonld.js's scoped-context branch (lib/context.js) discards the loader
    // failure entirely and throws a fresh 'invalid scoped context' JsonLdError
    // with no `details.cause` of its own, so this can only pass if
    // validateJsonLd recovers the guard's rejection some other way (tracking
    // it at the document-loader call, see `validate-jsonld.ts`).
    expect(nativeCauseChain(error)).toContainEqual(expect.any(UrlValidationError));
    // The security property: the loopback canary was never reached.
    expect(hits).toBe(0);
  });
});
