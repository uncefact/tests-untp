import type { IDataModelBridge, UNTPVerifiableCredential } from '@uncefact/untp-ri-services';
import { asDateTime, asNonEmptyString } from '@uncefact/untp-utils/common';
/**
 * Descriptive fields captured onto a credential row at issue time (#952).
 */
export type CredentialDetails = {
  name: string | null;
  issuerName: string | null;
  issuerDid: string | null;
  subjectName: string | null;
  subjectId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
};

/**
 * This is the boundary where reading a document becomes writing a row, so
 * every absence the readers report as `undefined` is recorded here as the
 * `null` the column holds.
 */
function captured<T>(value: T | undefined): T | null {
  return value ?? null;
}

/**
 * Reads library-facing descriptive fields from a decoded signed credential.
 *
 * `name` is the credential's own asserted `.name` when that is a non-empty
 * string. There is no subject or facility-name fallback (#952). A single
 * The `credentialSubject` is handed to `bridge.extractSubjectSummary` as the
 * credential carries it, because the bridge knows where this data model
 * places the subject's id and display name, and what to describe when the
 * credential carries several subjects.
 *
 * Every field may be null at once (a string issuer, an array subject, no
 * name, no validity dates). That is still a complete capture: `EXTRACTED`
 * on the row means extraction ran, not that it found values.
 */
export function extractCredentialDetails(
  credential: UNTPVerifiableCredential,
  bridge: IDataModelBridge,
): CredentialDetails {
  const issuer = credential.issuer as unknown;

  let issuerDid: string | null = null;
  let issuerName: string | null = null;
  if (typeof issuer === 'string') {
    issuerDid = captured(asNonEmptyString(issuer));
  } else if (issuer !== null && typeof issuer === 'object') {
    const issuerObject = issuer as { id?: unknown; name?: unknown };
    issuerDid = captured(asNonEmptyString(issuerObject.id));
    issuerName = captured(asNonEmptyString(issuerObject.name));
  }

  let subjectName: string | null = null;
  let subjectId: string | null = null;
  const subject = credential.credentialSubject;
  if (subject !== null && typeof subject === 'object') {
    const summary = bridge.extractSubjectSummary(subject);
    subjectName = captured(summary.name);
    subjectId = captured(summary.id);
  }

  return {
    name: captured(asNonEmptyString(credential.name)),
    issuerName,
    issuerDid,
    subjectName,
    subjectId,
    validFrom: captured(asDateTime(credential.validFrom)),
    validUntil: captured(asDateTime(credential.validUntil)),
  };
}
