// Subpath barrel: the main entry re-exports linkResolver.service which depends
// on digitallink_toolkit_server (a local-only package not published to npm).
// This barrel lets consumers import key-provider without hitting that dependency.
// Remove once digitallink_toolkit_server is eliminated (https://github.com/uncefact/tests-untp/issues/401).
export type { IKeyGenerator, IKeyStore } from './key-provider.interface.js';
export { LocalKeyGenerator } from './adapters/local/local.adapter.js';
