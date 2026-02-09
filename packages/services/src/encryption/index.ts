// Subpath barrel: the main entry re-exports linkResolver.service which depends
// on digitallink_toolkit_server (a local-only package not published to npm).
// This barrel lets consumers import encryption without hitting that dependency.
// Remove once digitallink_toolkit_server is eliminated (https://github.com/uncefact/tests-untp/issues/401).
export { AesGcmEncryptionAdapter } from './adapters/aes-gcm/aes-gcm.adapter.js';
export { EncryptionAlgorithm, assertPermittedAlgorithm } from './encryption.interface.js';
export type { EncryptedEnvelope, IEncryptionService } from './encryption.interface.js';
export { computeHash, HashAlgorithm } from './compute-hash.js';
export { decryptCredential } from './decrypt-credential.js';
export type { DecryptionParams } from './decrypt-credential.js';
