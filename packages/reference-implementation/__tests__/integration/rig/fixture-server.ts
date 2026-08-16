import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Fixture {
  body: string;
  contentType?: string;
  status?: number;
}

export interface FixtureServer {
  baseUrl: string;
  /** Registers or replaces the fixture served at `path` (leading slash). */
  set(path: string, fixture: Fixture): void;
  remove(path: string): void;
  close(): Promise<void>;
}

/**
 * Loopback HTTP server for schema documents, JSON-LD contexts, and
 * URL-entry scheme documents, so no integration test depends on a remote
 * host (ADR-029: mock external services at the HTTP boundary, keep internal
 * I/O real).
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const fixtures = new Map<string, Fixture>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const fixture = fixtures.get(url.pathname);
    if (!fixture) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`no fixture registered for ${url.pathname}`);
      return;
    }
    res.writeHead(fixture.status ?? 200, { 'content-type': fixture.contentType ?? 'application/json' });
    res.end(fixture.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    set: (path, fixture) => void fixtures.set(path, fixture),
    remove: (path) => void fixtures.delete(path),
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
