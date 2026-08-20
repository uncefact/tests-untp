/**
 * Test stub for `@uncefact/untp-utils/resolvers`.
 *
 * Wired up via `moduleNameMapper` in `jest.config.js` because the real
 * package ships as ESM-only, which this package's Jest CJS resolver cannot
 * load, and because the resolver performs DNS resolution and pinned network
 * connections that unit tests must never reach. Production code still
 * imports and uses the real package; only tests see this stub.
 *
 * The error classes mirror the real hierarchy's shape (`ResolverError` base,
 * `ResolverHttpError` with `status`) so production `instanceof` checks work
 * against errors constructed in tests. The fetch functions throw: a suite
 * that exercises resolution must `jest.mock('@uncefact/untp-utils/resolvers', ...)`
 * with its own behaviour (see verify-did-web.test.ts); a suite that merely
 * imports a module which transitively reaches the resolver never calls them.
 */

export class ResolverError extends Error {}

export class ResolverHttpError extends ResolverError {
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number) {
    super(`${url} returned status ${status}.`);
    this.status = status;
    this.url = url;
  }
}

export class ResolverNetworkError extends ResolverError {}
export class ResolverTooLargeError extends ResolverError {}
export class ResolverTooManyRedirectsError extends ResolverError {}
export class ResolverTimedOutError extends ResolverError {}
export class ResolverRedirectMissingLocationError extends ResolverError {}
export class ResolverInvalidJsonError extends ResolverError {
  readonly url: string;
  constructor(url: string, cause?: unknown) {
    super(`Response body for ${url} is not valid JSON.`, cause !== undefined ? { cause } : undefined);
    this.url = url;
  }
}

function notMocked(): never {
  throw new Error(
    '@uncefact/untp-utils/resolvers is stubbed in tests; jest.mock the module with per-test behaviour to exercise resolution',
  );
}

export const resolveDocument = notMocked;
export const resolveJsonDocument = notMocked;
export const resolveDocumentIfChanged = notMocked;
