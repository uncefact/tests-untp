import type { CredentialSubject, ExtractedRefs } from '../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DfrFacility = {
  registeredId?: string;
  operatedByParty?: { registeredId?: string };
};

type ConformityClaim = {
  referenceStandard?: { id?: string };
  referenceRegulation?: { id?: string };
  assessmentCriteria?: { id?: string }[];
};

type DfrSubject = {
  facility?: DfrFacility;
  conformityClaim?: ConformityClaim[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

export function extractDfrRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return {};

  const dfr = subject as DfrSubject;
  const facility = dfr.facility;
  if (!facility) return {};

  const refs: ExtractedRefs = {};

  if (facility.registeredId) {
    refs.facility = { id: facility.registeredId };
  }

  if (facility.operatedByParty?.registeredId) {
    refs.organisation = { id: facility.operatedByParty.registeredId };
  }

  if (dfr.conformityClaim && dfr.conformityClaim.length > 0) {
    const standardUrls: string[] = [];
    const regulationUrls: string[] = [];
    const criteriaUrls: string[] = [];

    for (const claim of dfr.conformityClaim) {
      if (claim.referenceStandard?.id) {
        standardUrls.push(claim.referenceStandard.id);
      }
      if (claim.referenceRegulation?.id) {
        regulationUrls.push(claim.referenceRegulation.id);
      }
      if (claim.assessmentCriteria) {
        for (const criterion of claim.assessmentCriteria) {
          if (criterion.id) {
            criteriaUrls.push(criterion.id);
          }
        }
      }
    }

    if (standardUrls.length > 0 || regulationUrls.length > 0 || criteriaUrls.length > 0) {
      refs.conformity = { standardUrls, regulationUrls, criteriaUrls };
    }
  }

  return refs;
}
