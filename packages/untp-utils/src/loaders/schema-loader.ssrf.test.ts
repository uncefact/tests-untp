import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSchemaLoader } from './schema-loader.js';
import { SchemaLoaderNetworkError } from './errors.js';
import { UrlValidationError } from '../node/errors.js';

/**
 * End-to-end SSRF regression for schema loading. Unlike `schema-loader.test.ts`,
 * this suite does NOT mock the resolver stack: it exercises the real
 * `createSchemaLoader` -> `resolveJsonDocument` -> `validatePublicUrl` chain
 * against a live loopback server standing in for an internal service.
 *
 * The load-bearing assertion is that the canary server is NEVER contacted. The
 * pre-guard implementation fetched schemas with a raw `fetch` that would have
 * reached a private URL; the guard rejects it before any connection.
 *
 * @see https://github.com/uncefact/tests-untp/issues/707
 */
describe('createSchemaLoader SSRF guard (real resolver stack)', () => {
  let server: http.Server;
  let baseUrl: string;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits += 1;
      res.setHeader('content-type', 'application/schema+json');
      res.end(JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema' }));
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

  it('never contacts a private schema URL', async () => {
    const error = await createSchemaLoader()
      .load(`${baseUrl}/schema.json`)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SchemaLoaderNetworkError);
    // The rejection came from the SSRF guard, preserved on the cause chain.
    expect((error as SchemaLoaderNetworkError).cause).toBeInstanceOf(UrlValidationError);
    // The security property: the loopback canary was never reached.
    expect(hits).toBe(0);
  });

  it('rejects a metadata-service schema URL literal', async () => {
    const error = await createSchemaLoader()
      .load('http://169.254.169.254/latest/schema.json')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SchemaLoaderNetworkError);
    expect((error as SchemaLoaderNetworkError).cause).toBeInstanceOf(UrlValidationError);
  });
});
