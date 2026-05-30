import { ConformityWarningCode } from './codes.js';
import type { ConformityClaim, ConformityScheme, ConformityWarning } from './types.js';

/**
 * Validates a credential's conformity claim against a parsed scheme.
 *
 * Short-circuits at the first miss:
 * - scheme null or `canonicalId` mismatch → only `conformity-scheme.not-found`.
 * - profile not in scheme → only `conformity-profile.not-found`.
 * - otherwise → criteria-level and topic-level warnings accumulate.
 *
 * Pointers are relative to `claim`; consumers re-map them by prepending
 * a wrapper path when the claim is extracted from a larger document.
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
        message: "Criterion URI is not in the profile's published criterion list.",
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
        message: 'Profile publishes a criterion that the claim does not address.',
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
    if (claimCriterion.conformityTopics === undefined) {
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
          message: 'The criterion defines a topic the claim does not declare.',
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
          message: 'The claim declares a topic the criterion does not define.',
          received: declared,
          expected: criterionTopicIds,
          pointer: `/criteria/${i}/conformityTopics/${t}`,
        });
      }
    });
  });

  return warnings;
}
