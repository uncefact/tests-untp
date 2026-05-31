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
 * across `conformityAssessment[].assessmentCriteria[]`. Each criterion may be
 * classified by one or more `conformityTopic` entries, all of which are
 * collected. The v0.7.0 data model always classifies criteria by topic, so
 * `conformityTopics` is always populated (empty when the credential declared
 * none), letting the validator flag a criterion that omits a topic the profile
 * publishes.
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
    if (!assessment) continue;
    for (const criterion of assessment.assessmentCriteria ?? []) {
      if (!criterion?.id) continue;
      const conformityTopics = (criterion.conformityTopic ?? [])
        .map((topic) => topic?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      criteria.push({ criterion: criterion.id, conformityTopics });
    }
  }

  return { scheme, profile, criteria };
}
