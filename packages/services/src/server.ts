/**
 * Server-only exports.
 *
 * These modules depend on Node.js built-ins (node:crypto) or native-optional
 * packages (jsonld/rdf-canonize) that break Next.js client-side webpack.
 * Import from '@uncefact/untp-ri-services/server' in server components, API routes,
 * and scripts — never in client components.
 */

// DID adapter + verification (jsonld depends on rdf-canonize-native)
export { VCKitDidAdapter } from './did-manager/adapters/vckit/vckit-did.adapter.js';
export { verifyDid } from './did-manager/common/verify.js';
export type { VerifyDidOptions } from './did-manager/common/verify.js';

// Encryption adapter (re-exported here for backwards compatibility)
export { AesGcmEncryptionAdapter } from './encryption/adapters/aes-gcm/aes-gcm.adapter.js';

// IDR adapter (Pyx Identity Resolver)
export { PyxIdentityResolverAdapter } from './identity-resolver/adapters/pyx/pyx-idr.adapter.js';

// Storage adapter (UNCEFACT)
export { UncefactStorageAdapter } from './storage/adapters/uncefact/uncefact-storage.adapter.js';

// VC adapter
export { VCKitVerifiableCredentialService } from './verifiable-credential/adapters/vckit/vckit-verifiable-credential.adapter.js';

// Registry (imports VCKit adapter which transitively pulls in jsonld)
export { adapterRegistry } from './registry/registry.js';
export { didAdapterRegistry } from './registry/did-adapter-registry.js';
