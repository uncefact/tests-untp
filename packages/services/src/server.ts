/**
 * Server-only exports.
 *
 * These modules depend on Node.js built-ins (node:crypto) or native-optional
 * packages (jsonld/rdf-canonize) that break Next.js client-side webpack.
 * Import from '@mock-app/services/server' in server components, API routes,
 * and scripts — never in client components.
 */

// DID adapter + verification (jsonld depends on rdf-canonize-native)
export { VCKitDidAdapter } from './did-manager/adapters/vckit/vckit-did.adapter.js';
export { verifyDid } from './did-manager/verify.js';
export type { VerifyDidOptions } from './did-manager/verify.js';

// Encryption adapter (node:crypto)
export { AesGcmEncryptionAdapter } from './encryption/adapters/aes-gcm/aes-gcm.adapter.js';

// Registry (imports VCKit adapter which transitively pulls in jsonld)
export { adapterRegistry } from './registry/registry.js';
