import type { ConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';
import type { ClaimSourceMap, ConformityClaimWithProvenance, CredentialSubject } from '../../../../types.js';

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
 * Collects the topics of a `conformityTopic` value, each with the path it was
 * read from relative to the `conformityTopic` field itself.
 *
 * Either a single topic object or an array of them is accepted: the
 * specification classifies a criterion by "a conformityTopic" (singular) and
 * the published schema puts no shape constraint on the criterion-level field,
 * so a lone topic authored as a bare object is captured rather than discarded,
 * and contributes the field itself with no index. A present-but-shapeless
 * value (a string, or an object without an `id`) yields nothing, so a kept
 * topic's source index is not its position in the result.
 */
function keptTopics(value: unknown): { id: string; path: string }[] {
  const isArray = Array.isArray(value);
  const topics = isArray ? value : [value];
  return topics.flatMap((topic, index) => {
    const id = (topic as DccTopic | null)?.id;
    if (typeof id !== 'string' || id.length === 0) return [];
    return [{ id, path: isArray ? `/${index}` : '' }];
  });
}

/**
 * Records a `conformityTopics` projection in `sourceMap` and returns the kept
 * topics' ids, for both the criterion-level and assessment-level declarations
 * in {@link extractDccConformityClaimWithProvenance}. The base entry maps the
 * whole array; each kept topic additionally gets its own entry, since a
 * dropped topic (no usable `id`) shifts the projected index away from the
 * source index and a suffix on the base path would then name the wrong topic.
 */
function recordTopics(
  sourceMap: ClaimSourceMap,
  claimPath: string,
  subjectPath: string,
  kept: { id: string; path: string }[],
): string[] {
  sourceMap[`${claimPath}/conformityTopics`] = subjectPath;
  kept.forEach((topic, position) => {
    sourceMap[`${claimPath}/conformityTopics/${position}`] = `${subjectPath}${topic.path}`;
  });
  return kept.map((topic) => topic.id);
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
  return extractDccConformityClaimWithProvenance(subject)?.claim ?? null;
}

/**
 * Extracts the claim and, alongside it, the subject path each projected value
 * was read from, so a consumer holding the credential can resolve a warning's
 * pointer against the document its caller submitted (#753).
 *
 * A pointer into the claim cannot be turned into a pointer into the subject by
 * prepending a prefix. `criteria` is flattened across every assessment and
 * records no origin, the claim says `conformityTopics` where the credential
 * says `conformityTopic`, and topic entries without a usable `id` are dropped,
 * so a projected topic index need not match its source index. Every
 * addressable value therefore gets its own entry rather than being derived
 * from its parent's path.
 *
 * Values the validator can point at but the document does not contain are
 * deliberately absent from the map: an unspecified profile, and a criterion
 * the claim never declared. A consumer omits the pointer for those.
 *
 * @param subject - The DCC `credentialSubject`.
 * @returns The claim and its source map, or `null` on the same terms as
 *   {@link extractDccConformityClaim}.
 */
export function extractDccConformityClaimWithProvenance(
  subject: CredentialSubject,
): ConformityClaimWithProvenance | null {
  const dcc = subject as DccConformitySubject;
  const scheme = dcc.referenceScheme?.id;
  const profile = dcc.referenceProfile?.id;

  if (!scheme) {
    return null;
  }

  const sourceMap: ClaimSourceMap = { '/scheme': '/referenceScheme/id' };
  // Recorded only when the claim carries a profile. `/profile` is also the
  // pointer on the not-specified warning, where the document has no profile to
  // point at, and an entry here would name a path that is not in it.
  if (profile) sourceMap['/profile'] = '/referenceProfile/id';

  const criteria: ConformityClaim['criteria'] = [];
  const assessments: NonNullable<ConformityClaim['assessments']> = [];
  for (const [assessmentIndex, assessment] of (dcc.conformityAssessment ?? []).entries()) {
    if (!assessment) continue;
    const assessmentPath = `/conformityAssessment/${assessmentIndex}`;
    const assessmentClaimIndex = assessments.length;
    const assessmentCriteriaIds: string[] = [];
    for (const [criterionIndex, criterion] of (assessment.assessmentCriteria ?? []).entries()) {
      if (!criterion?.id) continue;
      assessmentCriteriaIds.push(criterion.id);
      // `!= null` distinguishes absent-or-null (the credential does not
      // classify the criterion, so the topic check is skipped per ADR-038)
      // from a present declaration. `keptTopics` captures a single topic
      // object or an array of them; a present-but-shapeless value (a string, or an
      // object without an `id`) extracts as an empty declaration rather than
      // collapsing into absent, so the validator still runs against it. A JSON
      // `null` counts as absent because JSON-LD 1.1 drops null-valued entries
      // at expansion, making null the idiom for "no declaration".
      const criterionPath = `${assessmentPath}/assessmentCriteria/${criterionIndex}`;
      const criterionClaimPath = `/criteria/${criteria.length}`;
      sourceMap[`${criterionClaimPath}/criterion`] = `${criterionPath}/id`;
      if (criterion.conformityTopic != null) {
        const conformityTopics = recordTopics(
          sourceMap,
          criterionClaimPath,
          `${criterionPath}/conformityTopic`,
          keptTopics(criterion.conformityTopic),
        );
        criteria.push({ criterion: criterion.id, conformityTopics });
      } else {
        criteria.push({ criterion: criterion.id });
      }
    }
    // Every non-null assessment gets an entry, including empty ones, so
    // `/assessments/{i}` warning pointers track the source document's
    // assessment order. Empty entries are inert: the validator's no-criteria
    // guard produces no verdict for them.
    const conformityTopics = recordTopics(
      sourceMap,
      `/assessments/${assessmentClaimIndex}`,
      `${assessmentPath}/conformityTopic`,
      keptTopics(assessment.conformityTopic),
    );
    assessments.push({ criteria: assessmentCriteriaIds, conformityTopics });
  }

  const claim: ConformityClaim = {
    scheme,
    ...(profile && { profile }),
    criteria,
    ...(assessments.length > 0 && { assessments }),
  };
  return { claim, sourceMap };
}
