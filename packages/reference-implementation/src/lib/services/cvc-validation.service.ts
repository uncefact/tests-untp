import { findCriteriaByCanonicalIds, findProfileWithCriteriaByCanonicalId } from '@/lib/prisma/repositories';
import type { ConformityRefs } from '@uncefact/untp-ri-services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CvcValidationWarningCode =
  | 'CVC_NO_SCOPE'
  | 'CVC_SCOPE_NOT_FOUND'
  | 'CVC_UNKNOWN_CRITERION'
  | 'CVC_MISSING_CRITERION'
  | 'CVC_NO_CRITERIA'
  | 'CVC_NO_CONFORMITY'
  | 'CVC_VALIDATION_ERROR'
  | 'IDR_PUBLISH_FAILED'
  | 'PUBLISH_SKIPPED'
  | 'DB_STATUS_UPDATE_FAILED';

export type CvcValidationWarning = {
  code: CvcValidationWarningCode;
  message: string;
  detail?: string;
};

export type CvcValidationResult = {
  warnings: CvcValidationWarning[];
};

// ---------------------------------------------------------------------------
// validateCvcCompliance
// ---------------------------------------------------------------------------

/**
 * Validates CVC references extracted from a DCC credential payload against
 * imported CVC catalogue data. Validation is advisory only — it produces
 * warnings, never errors.
 */
export async function validateCvcCompliance(
  tenantId: string,
  conformityRefs: ConformityRefs | undefined,
): Promise<CvcValidationResult> {
  const warnings: CvcValidationWarning[] = [];

  // Non-DCC credential or no conformity data — nothing to validate
  if (!conformityRefs) {
    return { warnings };
  }

  // No conformity scope — short-circuit
  if (!conformityRefs.schemeUrl) {
    warnings.push({
      code: 'CVC_NO_SCOPE',
      message: 'No conformity scope found in credential payload',
    });
    return { warnings };
  }

  // No criteria URLs — short-circuit
  if (conformityRefs.criteriaUrls.length === 0) {
    warnings.push({
      code: 'CVC_NO_CRITERIA',
      message: 'No conformity criteria found in credential payload',
    });
    return { warnings };
  }

  // Look up the profile matching the credential's scope URL
  const profile = await findProfileWithCriteriaByCanonicalId(tenantId, conformityRefs.schemeUrl);

  if (!profile) {
    warnings.push({
      code: 'CVC_SCOPE_NOT_FOUND',
      message: 'Conformity scope does not match any imported profile',
      detail: conformityRefs.schemeUrl,
    });
  } else {
    // Check for criteria required by the profile but absent from the credential
    const credentialCriteriaSet = new Set(conformityRefs.criteriaUrls);
    for (const pc of profile.criteria) {
      if (!credentialCriteriaSet.has(pc.criterion.canonicalId)) {
        warnings.push({
          code: 'CVC_MISSING_CRITERION',
          message: 'Criterion required by profile but not present in credential',
          detail: pc.criterion.canonicalId,
        });
      }
    }
  }

  // Look up criteria by canonical IDs
  const foundCriteria = await findCriteriaByCanonicalIds(tenantId, conformityRefs.criteriaUrls);
  const foundIds = new Set(foundCriteria.map((c) => c.canonicalId));

  // Flag any criteria URLs not found in the imported catalogues
  for (const criterionUrl of conformityRefs.criteriaUrls) {
    if (!foundIds.has(criterionUrl)) {
      warnings.push({
        code: 'CVC_UNKNOWN_CRITERION',
        message: 'Criterion not found in any imported CVC catalogue',
        detail: criterionUrl,
      });
    }
  }

  return { warnings };
}
