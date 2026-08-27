import type { CredentialSubject, CredentialSubjectInput, SubjectSummary } from '../../../../types.js';
import { extractGenericSubjectSummary, firstSubject } from '../../../../primitives/subject-summary.js';

// Matches buildDfrSubject: the facility sits at credentialSubject.facility with its own id and name.
export function extractDfrSubjectSummary(subject: CredentialSubjectInput): SubjectSummary {
  const facility = firstSubject(subject)?.facility;
  if (facility === null || typeof facility !== 'object' || Array.isArray(facility)) {
    return { id: undefined, name: undefined };
  }
  return extractGenericSubjectSummary(facility as CredentialSubject);
}
