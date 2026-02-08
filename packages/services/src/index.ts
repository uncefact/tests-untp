export * from './types/index.js';
export * from './interfaces/index.js';
export * from './epcisEvents/index.js';
export * from './processDPP.service.js';
export * from './processDigitalIdentityAnchor.service.js';
export * from './processDigitalFacilityRecord.service.js';
export * from './processDigitalConformityCredential.service.js';
export * from './vckit.service.js';
export * from './linkResolver.service.js';
export * from './storage.service.js';
export * from './utils/index.js';
export * from './identityProviders/index.js';
export * from './features/index.js';
export * from './api.service.js';
export * from './identifierSchemes/index.js';
export * from './adapters/index.js';
export type {
  CredentialPayload,
  CredentialIssuer,
  CredentialSubject,
  CredentialStatus,
  EnvelopedVerifiableCredential,
  UNTPVerifiableCredential,
  RenderMethod,
  VerifyResult,
  IVerifiableCredentialService,
} from './interfaces/verifiableCredentialService.js';
export * from './did-manager/types.js';
export { didDocumentSchema, verificationMethodSchema } from './did-manager/schemas.js';
export { didWebToUrl, parseDidMethod, normaliseDidAlias } from './did-manager/utils.js';
// Encryption
export { AesGcmEncryptionAdapter } from './encryption/adapters/aes-gcm/aes-gcm.adapter.js';
export { EncryptionAlgorithm, assertPermittedAlgorithm } from './encryption/encryption.interface.js';
export type { EncryptedEnvelope, IEncryptionService } from './encryption/encryption.interface.js';
export { computeHash, HashAlgorithm } from './encryption/compute-hash.js';
export { decryptCredential } from './encryption/decrypt-credential.js';
export type { DecryptionParams } from './encryption/decrypt-credential.js';
export type { IKeyGenerator, IKeyStore } from './key-provider/key-provider.interface.js';
export { LocalKeyGenerator } from './key-provider/adapters/local/local.adapter.js';

// Registry (types only — runtime registry re-exported from ./server entrypoint)
export { ServiceType, AdapterType } from './registry/types.js';
export type { AdapterRegistryEntry, AdapterRegistry } from './registry/types.js';

// Config schemas
export { vckitDidConfigSchema, vckitDidSensitiveFields } from './did-manager/adapters/vckit/vckit-did.schema.js';
export type { VCKitDidConfig } from './did-manager/adapters/vckit/vckit-did.schema.js';
