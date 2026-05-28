import type { ConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';
import type { CredentialSubject } from '../../../../types.js';

// Subset of the v0.7.0 DCC credentialSubject shape relevant to the conformity
// claim. The scheme and profile are referenced at the subject root; the
// criteria (and their topics) live on each conformity assessment.
type DccTopic = { id?: string };
type DccCriterion = { id?: string; conformityTopic?: DccTopic[] };
type DccAssessment = { assessmentCriteria?: DccCriterion[] };
type DccConformitySubject = {
  referenceScheme?: { id?: string };
  referenceProfile?: { id?: string };
  conformityAssessment?: DccAssessment[];
};

/**
 * Extracts the conformity claim from a v0.7.0 Digital Conformity Credential
 * subject into the minimal shape {@link ConformityClaim} the validator needs.
 *
 * The v0.7.0 DCC does not carry a single `conformityClaim` object; the claim is
 * assembled from `referenceScheme`, `referenceProfile`, and the criteria listed
 * across `conformityAssessment[].assessmentCriteria[]`. Each criterion's first
 * `conformityTopic` (when present) scopes the claim for that criterion.
 *
 * @param subject - The DCC `credentialSubject`.
 * @returns The extracted claim, or `null` when the subject references neither a
 *   scheme nor a profile (nothing to validate against the catalogue).
 */
export function extractDccConformityClaim(subject: CredentialSubject): ConformityClaim | null {
  const dcc = subject as DccConformitySubject;
  const scheme = dcc.referenceScheme?.id;
  const profile = dcc.referenceProfile?.id;

  if (!scheme || !profile) {
    return null;
  }

  const criteria: ConformityClaim['criteria'] = [];
  for (const assessment of dcc.conformityAssessment ?? []) {
    for (const criterion of assessment.assessmentCriteria ?? []) {
      if (!criterion.id) continue;
      const topic = criterion.conformityTopic?.[0]?.id;
      criteria.push({ criterion: criterion.id, ...(topic ? { conformityTopic: topic } : {}) });
    }
  }

  return { scheme, profile, criteria };
}
