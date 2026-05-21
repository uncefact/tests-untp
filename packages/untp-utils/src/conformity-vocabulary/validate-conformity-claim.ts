import type { ValidationOutcome } from '../validation-outcome.js';
import { ConformityWarningCode } from './codes.js';
import type { ConformityClaim, ConformityScheme, ConformityWarning } from './types.js';

/**
 * Validates a credential's conformity claim against a parsed scheme. The
 * function is pure: it never fetches, never reads the database, never throws
 * for input-related failures, and never mutates its inputs. The caller is
 * responsible for sourcing the scheme that `claim.scheme` refers to.
 *
 * Per ADR-034, the outcome carries both `errors[]` (always empty in this
 * function because the inputs are typed) and `warnings[]` (the meaningful
 * output). The walk goes scheme → profile → criteria → criterion topics and
 * short-circuits at the first miss:
 *
 * - If `scheme` is null (or its `canonicalId` doesn't match `claim.scheme`),
 *   only `conformity-scheme.not-found` is emitted.
 * - If the claim's profile is not in the scheme, only
 *   `conformity-profile.not-found` is emitted.
 * - Otherwise the criteria-level and topic-level checks run.
 *
 * Pointers on emitted warnings are relative to `claim`. Consumers re-map
 * them by prepending a wrapper path if the claim was extracted from a
 * larger document (e.g. an RI flow would prepend
 * `/credentialSubject/conformityClaim` for display in the credential).
 *
 * @param claim - Conformity claim extracted from a DCC.
 * @param scheme - The parsed scheme the caller looked up by `claim.scheme`,
 *   or `null` when no scheme could be found.
 * @returns A {@link ValidationOutcome} carrying advisory warnings.
 *
 * @see ADR-033 §3 for warning code definitions.
 * @see ADR-034 for the error and warning reporting convention.
 */
export function validateConformityClaim(claim: ConformityClaim, scheme: ConformityScheme | null): ValidationOutcome {
  const warnings: ConformityWarning[] = [];
  const errors: never[] = [];

  if (!scheme || scheme.canonicalId !== claim.scheme) {
    warnings.push({
      code: ConformityWarningCode.SchemeNotFound,
      message: 'Scheme URI is not in the known set.',
      received: claim.scheme,
      pointer: '/scheme',
    });
    return { errors, warnings };
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
    return { errors, warnings };
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

  return { errors, warnings };
}
