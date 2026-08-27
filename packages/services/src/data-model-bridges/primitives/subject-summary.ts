import { asNonEmptyString } from '@uncefact/untp-utils/common';
import type { CredentialSubject, CredentialSubjectInput, SubjectSummary } from '../types.js';

/**
 * The one subject a summary describes: the subject itself, or the first
 * element when the credential carries several (see
 * {@link IDataModelBridge.extractSubjectSummary}).
 */
export function firstSubject(subject: CredentialSubjectInput): CredentialSubject | undefined {
  const single = Array.isArray(subject) ? subject[0] : subject;
  return single !== null && typeof single === 'object' && !Array.isArray(single) ? single : undefined;
}

/** The rule every version falls back to: the subject's own top-level id and name. */
export function extractGenericSubjectSummary(subject: CredentialSubjectInput): SubjectSummary {
  const single = firstSubject(subject);
  return {
    id: asNonEmptyString(single?.id),
    name: asNonEmptyString(single?.name),
  };
}
