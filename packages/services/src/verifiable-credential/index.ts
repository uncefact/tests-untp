export { decodeCredential } from './common/decode-credential.js';
/** Status parsers require `options.source` so callers choose input or response semantics explicitly. */
export {
  canonicalStatusListIndex,
  parseCredentialStatus,
  parseCredentialStatusEntry,
  type CredentialStatusParseOptions,
  type CredentialStatusParseSource,
} from './common/credential-status.js';
export { checkValidityWindow, type EnvelopeValidityWindowOutcome } from './common/validity-window.js';
export {
  VcDecodeError,
  VcServiceError,
  VcSignError,
  VcVerifyError,
  VcCredentialStatusError,
  VcStatusReadError,
  VcStatusSetError,
  VcStatusResponseInvalidError,
  VcStatusListNotFoundError,
  VcStatusEntryUnsupportedError,
} from './errors.js';
export type {
  EnvelopedVerifiableCredential,
  UNTPVerifiableCredential,
  CredentialSubject,
  CredentialStatusEntry,
  CanonicalCredentialStatusEntry,
  StatusMessage,
  CredentialStatus,
  SignOptions,
  SetCredentialStatusInput,
  GetCredentialStatusInput,
  CredentialStatusObservation,
  IVerifiableCredentialService,
} from './types.js';
