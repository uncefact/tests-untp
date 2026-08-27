import { asNonEmptyString } from '@uncefact/untp-utils/common';
import type { CredentialSubjectInput, SubjectSummary } from '../../../../types.js';
import { firstSubject } from '../../../../primitives/subject-summary.js';

// Matches buildDiaSubject: the display name is registeredName, not name.
export function extractDiaSubjectSummary(subject: CredentialSubjectInput): SubjectSummary {
  const single = firstSubject(subject);
  return {
    id: asNonEmptyString(single?.id),
    name: asNonEmptyString(single?.registeredName),
  };
}
