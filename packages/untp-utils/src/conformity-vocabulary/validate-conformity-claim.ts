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

  // criterion-topic-mismatch
  claim.criteria.forEach((claimCriterion, i) => {
    if (!claimCriterion.conformityTopic) {
      return;
    }
    const schemeCriterion = profileCriteriaById.get(claimCriterion.criterion);
    if (!schemeCriterion) {
      // already surfaced by criterion-not-in-profile
      return;
    }
    const publishedTopicIds = schemeCriterion.topics.map((t) => t.canonicalId);
    if (!publishedTopicIds.includes(claimCriterion.conformityTopic)) {
      warnings.push({
        code: ConformityWarningCode.CriterionTopicMismatch,
        message: "Claim's declared topic is not among the criterion's published topics.",
        received: claimCriterion.conformityTopic,
        expected: publishedTopicIds,
        pointer: `/criteria/${i}/conformityTopic`,
      });
    }
  });

  return warnings;
}
