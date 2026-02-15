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
export {
  didDocumentSchema,
  verificationMethodSchema,
  didResponseSchema,
  verificationResultResponseSchema,
  didDocumentResponseSchema,
} from './did-manager/schemas.js';
export { didWebToUrl, parseDidMethod, normaliseDidWebAlias } from './did-manager/common/utils.js';
// Encryption
export { AesGcmEncryptionAdapter } from './encryption/adapters/aes-gcm/aes-gcm.adapter.js';
export { EncryptionAlgorithm, assertPermittedAlgorithm } from './encryption/encryption.interface.js';
export type { EncryptedEnvelope, IEncryptionService } from './encryption/encryption.interface.js';
export { computeHash, HashAlgorithm } from './encryption/compute-hash.js';
export { decryptCredential } from './encryption/decrypt-credential.js';
export type { DecryptionParams } from './encryption/decrypt-credential.js';
export type { IKeyGenerator, IKeyStore } from './key-provider/key-provider.interface.js';
export { LocalKeyGenerator } from './key-provider/adapters/local/local.adapter.js';

// Logging
export type { LoggerService, LogContext, LoggerConfig, LogLevel } from './logging/types.js';
export { createLogger } from './logging/factory.js';
// correlation-context uses async_hooks (Node.js-only) — import from '@uncefact/untp-ri-services/logging' in server code

// Registry (types only — runtime registry re-exported from ./server entrypoint)
export { ServiceType, AdapterType } from './registry/types.js';
export { BaseServiceAdapter } from './registry/base-adapter.js';
export type { AdapterRegistryEntry, AdapterRegistry } from './registry/types.js';

// Config schemas
export { vckitDidConfigSchema, vckitDidSensitiveFields } from './did-manager/adapters/vckit/vckit-did.schema.js';
export type { VCKitDidConfig } from './did-manager/adapters/vckit/vckit-did.schema.js';

// Service errors
export { ServiceError } from './errors.js';
export {
  DidError,
  DidConfigError,
  DidMethodNotSupportedError,
  DidInputError,
  DidCreateError,
  DidDocumentFetchError,
  DidParseError,
} from './did-manager/errors.js';

// IDR service types and constants
export { IDR_SERVICE_TYPE, AccessRole } from './identity-resolver/types.js';
export type {
  RFC9264Link,
  UNTPLinkExtensions,
  Link,
  LinkRegistration,
  PublishLinksOptions,
  ResolverDescription,
  LinkType as IdrLinkType,
  IIdentityResolverService,
} from './identity-resolver/types.js';
export {
  IdrError,
  IdrLinkNotFoundError,
  IdrPublishError,
  IdrLinkFetchError,
  IdrLinkUpdateError,
  IdrLinkDeleteError,
  IdrResolverFetchError,
  IdrLinkTypesFetchError,
} from './identity-resolver/errors.js';
export { PYX_IDR_ADAPTER_TYPE } from './identity-resolver/adapters/pyx/pyx-idr.adapter.js';
export type { PyxIdrConfig } from './identity-resolver/adapters/pyx/pyx-idr.schema.js';
export { pyxIdrConfigSchema, pyxIdrSensitiveFields } from './identity-resolver/adapters/pyx/pyx-idr.schema.js';

// IDR API response schemas
export {
  registrarSchema,
  schemeQualifierSchema,
  identifierSchemeSchema,
  identifierSchema,
  linkRegistrationSchema,
} from './identity-resolver/schemas.js';

// Shared API response schemas
export { errorResponseSchema } from './schemas.js';

// IDR verification utilities
export type { VerificationWarning } from './identity-resolver/common/idr-verification.js';
export { verifyResolverDescription, verifyUntpLinkTypes } from './identity-resolver/common/idr-verification.js';
