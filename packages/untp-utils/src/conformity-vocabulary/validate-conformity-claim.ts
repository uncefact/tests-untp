import { ConformityWarningCode } from './codes.js';
import type { ConformityClaim, ConformityCriterion, ConformityScheme, ConformityWarning } from './types.js';

/**
 * Validates a credential's conformity claim against a parsed scheme.
 *
 * Short-circuits at the first miss:
 * - scheme null or `canonicalId` mismatch → only `conformity-scheme.not-found`.
 * - profile absent on the claim → scheme check plus a
 *   `conformity-profile.not-specified` advisory; criteria are published per
 *   versioned profile, so without one the criterion and topic checks cannot
 *   run, and silence would be indistinguishable from a clean pass.
 * - profile not in scheme → only `conformity-profile.not-found`.
 * - otherwise → criteria-level, criterion-topic, and assessment-topic warnings
 *   accumulate.
 *
 * Pointers are relative to `claim`; consumers re-map them by prepending
 * a wrapper path when the claim is extracted from a larger document. Note
 * that `/assessments/{i}` indexes the claim's `assessments` array, whose
 * positions are not guaranteed to match the source document's assessment
 * indices, because an extractor may filter empty or malformed entries.
 *
 * @see ADR-033 §3 for warning code definitions.
 */
export function validateConformityClaim(
  claim: ConformityClaim,
  scheme: ConformityScheme | null,
): readonly ConformityWarning[] {
  const warnings: ConformityWarning[] = [];

  if (!scheme || scheme.canonicalId !== claim.scheme) {
    warnings.push({
      code: ConformityWarningCode.SchemeNotFound,
      message: 'Scheme URI is not in the known set.',
      received: claim.scheme,
      pointer: '/scheme',
    });
    return warnings;
  }

  // `== null` covers undefined and a runtime null from JSON or database rows.
  if (claim.profile == null) {
    warnings.push({
      code: ConformityWarningCode.ProfileNotSpecified,
      message:
        'The claim references no profile; criterion and topic checks were not performed because criteria are published per profile.',
      pointer: '/profile',
    });
    return warnings;
  }

  const profile = scheme.profiles.find((p) => p.canonicalId === claim.profile);
  if (!profile) {
    warnings.push({
      code: ConformityWarningCode.ProfileNotFound,
      message: "Profile URI is not among the scheme's published profiles.",
      received: claim.profile,
      expected: scheme.profiles.map((p) => p.canonicalId),
      pointer: '/profile',
    });
    return warnings;
  }

  const profileCriteriaById = new Map(profile.criteria.map((c) => [c.canonicalId, c]));
  const claimCriteriaIds = new Set(claim.criteria.map((c) => c.criterion));
  const publishedCriterionIds = profile.criteria.map((c) => c.canonicalId);

  // criterion-not-in-profile
  claim.criteria.forEach((claimCriterion, i) => {
    if (!profileCriteriaById.has(claimCriterion.criterion)) {
      warnings.push({
        code: ConformityWarningCode.CriterionNotInProfile,
        message: `Criterion URI is not in the criterion list published by profile ${profile.canonicalId}.`,
        received: claimCriterion.criterion,
        expected: publishedCriterionIds,
        pointer: `/criteria/${i}/criterion`,
      });
    }
  });

  // criterion-missing
  for (const profileCriterion of profile.criteria) {
    if (!claimCriteriaIds.has(profileCriterion.canonicalId)) {
      warnings.push({
        code: ConformityWarningCode.CriterionMissing,
        message: `Profile ${profile.canonicalId} publishes a criterion that the claim does not address.`,
        expected: profileCriterion.canonicalId,
        pointer: '/criteria',
      });
    }
  }

  // criterion-topic-mismatch: each criterion defines its own conformity topics,
  // and a profile references a collection of independently-versioned criteria.
  // For each criterion the claim addresses, the topics it declares should match
  // the topics that criterion defines. The check runs whenever the claim carries
  // a topic list, including an empty one, so a criterion that omits a topic it
  // defines is flagged. An absent list marks a data model that classifies
  // criteria without conformity topics, and the check passes over it.
  claim.criteria.forEach((claimCriterion, i) => {
    // `== null` covers both undefined and a runtime null (for example a claim
    // parsed from JSON or a database row where the optional field serialised
    // as null); an empty array still runs the check.
    if (claimCriterion.conformityTopics == null) {
      return;
    }
    const profileCriterion = profileCriteriaById.get(claimCriterion.criterion);
    if (!profileCriterion) {
      // already surfaced by criterion-not-in-profile
      return;
    }
    const criterionTopicIds = profileCriterion.topics.map((t) => t.canonicalId);
    const declaredTopics = claimCriterion.conformityTopics;

    // A topic the criterion defines that the claim leaves out.
    criterionTopicIds.forEach((expected) => {
      if (!declaredTopics.includes(expected)) {
        warnings.push({
          code: ConformityWarningCode.CriterionTopicMismatch,
          message: `The criterion, as published in profile ${profile.canonicalId}, defines a topic the claim does not declare.`,
          expected,
          pointer: `/criteria/${i}/conformityTopics`,
        });
      }
    });

    // A topic the claim declares that the criterion does not define.
    declaredTopics.forEach((declared, t) => {
      if (!criterionTopicIds.includes(declared)) {
        warnings.push({
          code: ConformityWarningCode.CriterionTopicMismatch,
          message: `The claim declares a topic the criterion, as published in profile ${profile.canonicalId}, does not define.`,
          received: declared,
          expected: criterionTopicIds,
          pointer: `/criteria/${i}/conformityTopics/${t}`,
        });
      }
    });
  });

  // assessment-topic-mismatch: an assessment's declared topics must sit within
  // the deduplicated union of the published topics of the criteria it
  // references. One direction only: an assessment may declare a subset of the
  // union (its topics categorise the assessment, they do not enumerate it), but
  // a declared topic outside the union references taxonomy none of its criteria
  // carry. The check runs only when the assessment references at least one
  // criterion and every referenced criterion resolves in the profile. With no
  // referenced criteria the parent-level topic is the only classification the
  // claim carries, so there is no criteria union to check it against. An
  // unresolved criterion could itself carry the declared topic, so warning
  // against a partial union would be unfounded, and unresolved criteria are
  // already surfaced by criterion-not-in-profile.
  claim.assessments?.forEach((assessment, i) => {
    if (assessment.criteria.length === 0) {
      return;
    }
    const resolvedCriteria = assessment.criteria
      .map((criterionId) => profileCriteriaById.get(criterionId))
      .filter((criterion): criterion is ConformityCriterion => criterion !== undefined);
    if (resolvedCriteria.length !== assessment.criteria.length) {
      return;
    }
    const unionTopicIds = new Set(resolvedCriteria.flatMap((criterion) => criterion.topics.map((t) => t.canonicalId)));
    assessment.conformityTopics.forEach((declared, t) => {
      if (!unionTopicIds.has(declared)) {
        warnings.push({
          code: ConformityWarningCode.AssessmentTopicMismatch,
          message: `The assessment declares a topic that none of its assessed criteria, as published in profile ${profile.canonicalId}, define.`,
          received: declared,
          expected: [...unionTopicIds],
          pointer: `/assessments/${i}/conformityTopics/${t}`,
        });
      }
    });
  });

  return warnings;
}
