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
export { VCKitDidService } from './did-manager/adapters/vckit-did.service.js';
export { verifyDid } from './did-manager/verify.js';
export type { VerifyDidOptions } from './did-manager/verify.js';

// Encryption
export type { IEncryptionService } from './encryption/encryption.interface.js';
export { AesGcmEncryptionAdapter } from './encryption/adapters/aes-gcm.adapter.js';

// Registry
export { ServiceType, AdapterType } from './registry/types.js';
export type { AdapterRegistryEntry, AdapterRegistry } from './registry/types.js';
export { adapterRegistry } from './registry/registry.js';

// Config schemas
export { vckitDidConfigSchema, vckitDidSensitiveFields } from './did-manager/adapters/vckit-did.schema.js';
export type { VCKitDidConfig } from './did-manager/adapters/vckit-did.schema.js';
