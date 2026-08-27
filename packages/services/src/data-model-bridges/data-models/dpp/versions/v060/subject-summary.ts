import type { CredentialSubject, CredentialSubjectInput, SubjectSummary } from '../../../../types.js';
import { extractGenericSubjectSummary, firstSubject } from '../../../../primitives/subject-summary.js';

// Matches buildDppSubject: the product sits at credentialSubject.product with its own id and name.
export function extractDppSubjectSummary(subject: CredentialSubjectInput): SubjectSummary {
  const product = firstSubject(subject)?.product;
  if (product === null || typeof product !== 'object' || Array.isArray(product)) {
    return { id: undefined, name: undefined };
  }
  return extractGenericSubjectSummary(product as CredentialSubject);
}
