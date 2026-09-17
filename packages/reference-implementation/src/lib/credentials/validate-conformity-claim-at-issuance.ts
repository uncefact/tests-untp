import type { CredentialPayload, ConformityClaimWithProvenance } from '@uncefact/untp-ri-services';
import { remapWarningPointers } from '@uncefact/untp-ri-services';
import type { StructuredWarning } from '@uncefact/untp-utils';
import { findConformitySchemeByCanonicalId, resolveConformityReferences } from '@/lib/prisma/repositories';
import type { ConformityReferenceResolution } from '@uncefact/untp-utils/conformity-vocabulary';
import { validateConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';

type IssuanceConformityWarning = StructuredWarning;

/**
 * Runs the advisory conformity checks for one issuance: the catalogue lookup,
 * the tier resolution it may need, the validator itself, and the two warnings
 * the validator cannot raise because their cause is the catalogue rather than
 * the claim.
 *
 * Validation is advisory (ADR-058 decision 1), so this runs inside the route's
 * step 3.6 boundary and a warning never blocks the credential response.
 * Scoring evidence comes from the selected scheme's stored document (decision
 * 9). The applicable scheme, profile, criterion and topic checks still run
 * when that evidence is missing or unreadable; without a profile, the
 * criterion and topic checks do not run. `conformity-claim.score-checks-unavailable`
 * reports the gap.
 *
 * The scheme graph and stored document are read in one repeatable-read snapshot,
 * while tier resolution remains a separate read (decision 10). A disagreement
 * triggers one fresh snapshot lookup. A scheme contradiction that survives the
 * reload has no graph and returns only `conformity-claim.validation-error`. A
 * profile contradiction that survives the reload returns the reloaded graph's
 * warnings, including `conformity-profile.not-found`, beside that advisory.
 */
export async function validateConformityClaimAtIssuance(
  extracted: ConformityClaimWithProvenance,
  credentialPayload: CredentialPayload,
  tenantId: string,
): Promise<IssuanceConformityWarning[]> {
  const carriesScore =
    extracted.claim.profileScore !== undefined ||
    extracted.claim.assessments?.some((assessment) => (assessment.assessedScores?.length ?? 0) > 0) === true;

  let lookup = await findConformitySchemeByCanonicalId(extracted.claim.scheme, tenantId, {
    projectScores: carriesScore,
  });
  let scheme = lookup?.scheme ?? null;
  let references: ConformityReferenceResolution | undefined;
  let inconsistentReads = false;

  if (!scheme) {
    const resolved = await resolveConformityReferences([extracted.claim.scheme], tenantId);
    references = { scheme: resolved.get(extracted.claim.scheme) ?? [] };
    // The resolver found as a scheme the very id the first read missed, so the
    // two reads disagree. Reload once through a fresh repeatable-read snapshot
    // and validate against that graph. Either way the resolver's match is
    // dropped rather than passed on: on success the scheme resolves and there
    // is nothing left to diagnose, and on failure the disagreement is reported
    // as an inconsistent read rather than as a not-found the claim may not
    // deserve.
    if ((references.scheme ?? []).some((match) => match.tier === 'scheme')) {
      const reloaded = await findConformitySchemeByCanonicalId(extracted.claim.scheme, tenantId, {
        projectScores: carriesScore,
      });
      if (!reloaded || reloaded.scheme.canonicalId !== extracted.claim.scheme) {
        lookup = null;
        scheme = null;
        references = undefined;
        inconsistentReads = true;
      } else {
        lookup = reloaded;
        scheme = reloaded.scheme;
        references = undefined;
      }
    }
  }

  if (
    scheme &&
    extracted.claim.profile != null &&
    !scheme.profiles.some((profile) => profile.canonicalId === extracted.claim.profile)
  ) {
    const resolved = await resolveConformityReferences([extracted.claim.profile], tenantId);
    references = { profile: resolved.get(extracted.claim.profile) ?? [] };
    const profileMatchForScheme = (references.profile ?? []).some(
      (match) => match.tier === 'profile' && match.schemes.includes(scheme!.canonicalId),
    );
    // Same disagreement one tier down: the resolver places this profile under
    // the selected scheme, but the graph from the first repeatable-read
    // snapshot does not hold it.
    if (profileMatchForScheme) {
      const reloaded = await findConformitySchemeByCanonicalId(extracted.claim.scheme, tenantId, {
        projectScores: carriesScore,
      });
      if (!reloaded) {
        lookup = null;
        scheme = null;
        references = undefined;
        inconsistentReads = true;
      } else {
        lookup = reloaded;
        scheme = reloaded.scheme;
        inconsistentReads = !scheme.profiles.some((profile) => profile.canonicalId === extracted.claim.profile);
        references = undefined;
      }
    }
  }

  const warnings: IssuanceConformityWarning[] = [];
  if (scheme || !inconsistentReads) {
    const claimWarnings = validateConformityClaim(extracted.claim, scheme, references);
    // The validator's pointers address the extracted claim, which is a
    // synthesised projection the caller never sees, so they are rewritten onto
    // the submitted credential using the paths the extractor recorded (#753).
    // A pointer that cannot be translated is dropped rather than returned.
    warnings.push(...remapWarningPointers(claimWarnings, extracted.sourceMap, credentialPayload, '/credentialSubject'));
  }
  if (inconsistentReads) {
    warnings.push({
      code: 'conformity-claim.validation-error',
      message:
        'Conformity claim validation could not be completed because the catalogue changed while the claim was checked; the credential was issued, and a later check against the catalogue gives a current verdict.',
    });
  }

  if (carriesScore && lookup && lookup.scoringEvidence !== 'available' && lookup.scoringEvidence !== 'not-requested') {
    warnings.push({
      code: 'conformity-claim.score-checks-unavailable',
      message:
        "Score codes were not checked because the scheme's stored document is unavailable; the applicable scheme, profile, criterion and topic checks still ran.",
      remediation:
        'Ask your operator to refresh the scheme in the catalogue, then issue again if you need the score codes checked.',
    });
  }

  return warnings;
}
