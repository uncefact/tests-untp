import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateJsonLd } from './validate-jsonld.js';
import { JsonLdExpansionFailedError } from './errors.js';
import { UrlValidationError } from '../node/errors.js';

/**
 * Digs the guard's rejection out of an expansion failure. jsonld.js wraps a
 * document loader's error in its own JsonLdError, which stores the original
 * at the non-standard `details.cause` and never sets native `Error.cause`.
 */
function buriedLoaderError(error: unknown): unknown {
  const jsonldError = (error as JsonLdExpansionFailedError).cause as { details?: { cause?: unknown } } | undefined;
  return jsonldError?.details?.cause;
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
    expect(buriedLoaderError(error)).toBeInstanceOf(UrlValidationError);
    // The security property: the loopback canary was never reached.
    expect(hits).toBe(0);
  });

  it('rejects a metadata-service @context literal before any connection', async () => {
    const malicious = { '@context': 'http://169.254.169.254/latest/meta-data', name: 'value' };

    const error = await validateJsonLd(malicious).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JsonLdExpansionFailedError);
    expect(buriedLoaderError(error)).toBeInstanceOf(UrlValidationError);
  });

  it('expands a document with an inline @context without any network fetch', async () => {
    const document = { '@context': { name: 'http://schema.org/name' }, name: 'Acme' };

    await expect(validateJsonLd(document)).resolves.toBeUndefined();
    expect(hits).toBe(0);
  });
});
