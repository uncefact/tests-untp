import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DccProduct = {
  registeredId?: string;
  batchNumber?: string;
  itemNumber?: string;
};

type DccProductVerification = { product?: DccProduct };
type DccFacilityVerification = { facility?: { registeredId?: string } };

type DccConformityAssessment = {
  referenceStandard?: { id?: string }[];
  referenceRegulation?: { id?: string }[];
  assessmentCriteria?: { id?: string }[];
  assessedProduct?: DccProductVerification[];
  assessedFacility?: DccFacilityVerification[];
  assessedOrganisation?: { registeredId?: string };
};

type DccSubject = {
  issuedToParty?: { registeredId?: string };
  referenceScheme?: { id?: string };
  conformityAssessment?: DccConformityAssessment[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDccRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dcc = subject as DccSubject;
  const refs: ExtractedRefs = { organisations: [], facilities: [], products: [] };

  // Organisation: issuedToParty is primary; assessedOrganisation is fallback.
  if (dcc.issuedToParty?.registeredId) {
    refs.organisations.push({ id: dcc.issuedToParty.registeredId });
  } else if (dcc.conformityAssessment?.[0]?.assessedOrganisation?.registeredId) {
    refs.organisations.push({ id: dcc.conformityAssessment[0].assessedOrganisation.registeredId });
  }

  const seenProductIds = new Set<string>();
  const seenFacilityIds = new Set<string>();

  if (dcc.conformityAssessment) {
    for (const assessment of dcc.conformityAssessment) {
      if (assessment.assessedProduct) {
        for (const pv of assessment.assessedProduct) {
          const p = pv.product;
          if (p?.registeredId && !seenProductIds.has(p.registeredId)) {
            seenProductIds.add(p.registeredId);
            refs.products.push({
              id: p.registeredId,
              ...(p.batchNumber && { batchNumber: p.batchNumber }),
              ...(p.itemNumber && { serialNumber: p.itemNumber }),
            });
          }
        }
      }

      if (assessment.assessedFacility) {
        for (const fv of assessment.assessedFacility) {
          if (fv.facility?.registeredId && !seenFacilityIds.has(fv.facility.registeredId)) {
            seenFacilityIds.add(fv.facility.registeredId);
            refs.facilities.push({ id: fv.facility.registeredId });
          }
        }
      }
    }
  }

  if (dcc.conformityAssessment && dcc.conformityAssessment.length > 0) {
    const schemeUrl = dcc.referenceScheme?.id;
    const standardUrls: string[] = [];
    const regulationUrls: string[] = [];
    const criteriaUrls: string[] = [];
    const seenCriteria = new Set<string>();

    for (const assessment of dcc.conformityAssessment) {
      if (assessment.referenceStandard) {
        for (const s of assessment.referenceStandard) {
          if (s.id) standardUrls.push(s.id);
        }
      }
      if (assessment.referenceRegulation) {
        for (const r of assessment.referenceRegulation) {
          if (r.id) regulationUrls.push(r.id);
        }
      }
      if (assessment.assessmentCriteria) {
        for (const criterion of assessment.assessmentCriteria) {
          if (criterion.id && !seenCriteria.has(criterion.id)) {
            seenCriteria.add(criterion.id);
            criteriaUrls.push(criterion.id);
          }
        }
      }
    }

    if (schemeUrl || standardUrls.length > 0 || regulationUrls.length > 0 || criteriaUrls.length > 0) {
      refs.conformity = {
        ...(schemeUrl && { schemeUrl }),
        standardUrls,
        regulationUrls,
        criteriaUrls,
      };
    }
  } else if (dcc.referenceScheme?.id) {
    refs.conformity = {
      schemeUrl: dcc.referenceScheme.id,
      standardUrls: [],
      regulationUrls: [],
      criteriaUrls: [],
    };
  }

  return refs;
}
