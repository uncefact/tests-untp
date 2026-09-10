/**
 * Integration stand-in for `@uncefact/untp-utils`'s node module, wired via
 * `moduleNameMapper` in `jest.integration.config.mjs`.
 *
 * Everything is the real build except `validatePublicUrl`: the production
 * SSRF guard (correctly) refuses loopback addresses, and the integration
 * suites serve every document, schema, and context from a loopback fixture
 * server (ADR-029: mock external services at the HTTP boundary, keep
 * internal I/O real). This override validates URL shape and scheme like the
 * real one but permits private addresses, so the resolver's fetch, redirect,
 * and size handling still run for real against the fixture server.
 */

import { isIP } from 'node:net';

import type { ValidatedAddresses } from '../../../../untp-utils/build/node/index.js';

export * from '../../../../untp-utils/build/node/index.js';

export async function validatePublicUrl(
  url: string,
  options?: { allowedSchemes?: readonly string[] },
): Promise<ValidatedAddresses> {
  const parsed = new URL(url);
  const scheme = parsed.protocol.toLowerCase().replace(/:$/, '');
  const allowed = options?.allowedSchemes ?? ['http', 'https'];
  if (!allowed.some((s) => s.toLowerCase() === scheme)) {
    throw new Error(`Unsupported scheme "${scheme}"`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const resolvedFamily: 4 | 6 = family === 6 ? 6 : 4;
  return { address: hostname, family: resolvedFamily, addresses: [{ address: hostname, family: resolvedFamily }] };
}
