import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DccProduct = {
  registeredId?: string;
  batchNumber?: string;
  serialNumber?: string;
};

type DccProductVerification = {
  product?: DccProduct;
};

type DccFacilityVerification = {
  facility?: { registeredId?: string };
};

type DccAssessment = {
  referenceStandard?: { id?: string };
  referenceRegulation?: { id?: string };
  assessmentCriteria?: { id?: string }[];
  assessedProduct?: DccProductVerification[];
  assessedFacility?: DccFacilityVerification[];
  assessedOrganisation?: { registeredId?: string };
};

type DccSubject = {
  issuedToParty?: { registeredId?: string };
  scope?: { id?: string };
  assessment?: DccAssessment[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

export function extractDccRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return {};

  const dcc = subject as DccSubject;
  const refs: ExtractedRefs = {};

  // Organisation: issuedToParty is primary; assessedOrganisation is fallback.
  // Different DCC schemas may place the organisation in different locations.
  // This fallback chain is intentional — see spec resolved question #7.
  if (dcc.issuedToParty?.registeredId) {
    refs.organisation = { id: dcc.issuedToParty.registeredId };
  } else if (dcc.assessment?.[0]?.assessedOrganisation?.registeredId) {
    refs.organisation = { id: dcc.assessment[0].assessedOrganisation.registeredId };
  }

  const firstAssessment = dcc.assessment?.[0];

  if (firstAssessment?.assessedProduct?.[0]?.product?.registeredId) {
    const p = firstAssessment.assessedProduct[0].product;
    refs.product = {
      id: p.registeredId!,
      ...(p.batchNumber && { batchNumber: p.batchNumber }),
      ...(p.serialNumber && { serialNumber: p.serialNumber }),
    };
  }

  if (firstAssessment?.assessedFacility?.[0]?.facility?.registeredId) {
    refs.facility = { id: firstAssessment.assessedFacility[0].facility.registeredId };
  }

  // Extract conformity refs from scope and all assessments
  if (dcc.assessment && dcc.assessment.length > 0) {
    const schemeUrl = dcc.scope?.id;
    const standardUrls: string[] = [];
    const regulationUrls: string[] = [];
    const criteriaUrls: string[] = [];
    const seenCriteria = new Set<string>();

    for (const assessment of dcc.assessment) {
      if (assessment.referenceStandard?.id) {
        standardUrls.push(assessment.referenceStandard.id);
      }
      if (assessment.referenceRegulation?.id) {
        regulationUrls.push(assessment.referenceRegulation.id);
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
  } else if (dcc.scope?.id) {
    // scope without assessments still contributes a schemeUrl
    refs.conformity = {
      schemeUrl: dcc.scope.id,
      standardUrls: [],
      regulationUrls: [],
      criteriaUrls: [],
    };
  }

  return refs;
}
