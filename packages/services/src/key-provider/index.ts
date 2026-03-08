// Subpath barrel: lets consumers import key-provider via '@uncefact/untp-ri-services/key-provider'
// without pulling in server-only dependencies (jsonld, rdf-canonize).
export type { IKeyGenerator, IKeyStore } from './key-provider.interface.js';
export { LocalKeyGenerator } from './adapters/local/local.adapter.js';
