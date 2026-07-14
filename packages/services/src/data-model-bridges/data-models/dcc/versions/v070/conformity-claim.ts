import type { ConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';
import type { CredentialSubject } from '../../../../types.js';

// Subset of the v0.7.0 DCC credentialSubject shape relevant to the conformity
// claim. The scheme and profile are referenced at the subject root. Conformity
// topics appear at two levels: the specification text requires each criterion
// in `assessmentCriteria` to be classified by a conformityTopic
// (https://untp.unece.org/docs/specification/ConformityCredential), while the
// published JSON Schema declares the field on the assessment only
// (https://untp.unece.org/artefacts/schema/v0.7.0/dcc/ConformityCredential.json,
// a spec/schema divergence reported upstream).
type DccTopic = { id?: string };
type DccCriterion = { id?: string; conformityTopic?: unknown };
type DccAssessment = { assessmentCriteria?: DccCriterion[]; conformityTopic?: unknown };
type DccConformitySubject = {
  referenceScheme?: { id?: string };
  referenceProfile?: { id?: string };
  conformityAssessment?: DccAssessment[];
};

/**
 * Collects topic URIs from a `conformityTopic` value, accepting either a single
 * topic object or an array of them. The specification classifies a criterion by
 * "a conformityTopic" (singular) and the published schema puts no shape
 * constraint on the criterion-level field, so a lone topic authored as a bare
 * object is captured rather than discarded. A present-but-shapeless value (a
 * string, or an object without an `id`) yields no ids.
 */
function topicIds(value: unknown): string[] {
  const topics = Array.isArray(value) ? value : [value];
  return topics
    .map((topic) => (topic as DccTopic | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Extracts the conformity claim from a v0.7.0 Digital Conformity Credential
 * subject into the minimal shape {@link ConformityClaim} the validator needs.
 *
 * The v0.7.0 DCC does not carry a single `conformityClaim` object; the claim is
 * assembled from `referenceScheme`, `referenceProfile`, and the criteria and
 * topic declarations across `conformityAssessment[]`. Each level's topics are
 * extracted verbatim from where the credential declares them, with no copying
 * between levels: a criterion's `conformityTopic` entries become that
 * criterion's declared topics (absent when the credential does not classify
 * the criterion, per ADR-038 while the spec/schema divergence stands), and
 * each assessment's `conformityTopic` entries become an assessment-level
 * declaration validated against the union of its criteria's published topics.
 * `referenceProfile` is not required by the schema, so the claim is extracted
 * without it and the validator degrades to scheme-level checks.
 *
 * @param subject - The DCC `credentialSubject`.
 * @returns The extracted claim, or `null` when the subject references no
 *   scheme (nothing to validate against the catalogue).
 */
export function extractDccConformityClaim(subject: CredentialSubject): ConformityClaim | null {
  const dcc = subject as DccConformitySubject;
  const scheme = dcc.referenceScheme?.id;
  const profile = dcc.referenceProfile?.id;

  if (!scheme) {
    return null;
  }

  const criteria: ConformityClaim['criteria'] = [];
  const assessments: NonNullable<ConformityClaim['assessments']> = [];
  for (const assessment of dcc.conformityAssessment ?? []) {
    if (!assessment) continue;
    const assessmentCriteriaIds: string[] = [];
    for (const criterion of assessment.assessmentCriteria ?? []) {
      if (!criterion?.id) continue;
      assessmentCriteriaIds.push(criterion.id);
      // `!= null` distinguishes absent-or-null (the credential does not
      // classify the criterion, so the topic check is skipped per ADR-038)
      // from a present declaration. `topicIds` captures a single topic object
      // or an array of them; a present-but-shapeless value (a string, or an
      // object without an `id`) extracts as an empty declaration rather than
      // collapsing into absent, so the validator still runs against it. A JSON
      // `null` counts as absent because JSON-LD 1.1 drops null-valued entries
      // at expansion, making null the idiom for "no declaration".
      criteria.push({
        criterion: criterion.id,
        ...(criterion.conformityTopic != null && { conformityTopics: topicIds(criterion.conformityTopic) }),
      });
    }
    // Every non-null assessment gets an entry, including empty ones, so
    // `/assessments/{i}` warning pointers track the source document's
    // assessment order. Empty entries are inert: the validator's no-criteria
    // guard produces no verdict for them.
    const assessmentTopics = topicIds(assessment.conformityTopic);
    assessments.push({ criteria: assessmentCriteriaIds, conformityTopics: assessmentTopics });
  }

  return { scheme, ...(profile && { profile }), criteria, ...(assessments.length > 0 && { assessments }) };
}
