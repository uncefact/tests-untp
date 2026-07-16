// Subpath barrel: lets consumers import encryption via '@uncefact/untp-ri-services/encryption'
// without pulling in server-only dependencies (jsonld, rdf-canonize).
export { AesGcmEncryptionAdapter } from './adapters/aes-gcm/aes-gcm.adapter.js';
export { EncryptionAlgorithm, assertPermittedAlgorithm } from './encryption.interface.js';
export type { EncryptedEnvelope, IEncryptionService } from './encryption.interface.js';
export { decryptCredential } from './decrypt-credential.js';
export type { DecryptionParams } from './decrypt-credential.js';
export { isEncryptedEnvelope, hasValidEnvelopeStructure } from './is-encrypted-envelope.js';
