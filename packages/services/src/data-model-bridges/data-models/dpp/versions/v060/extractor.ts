import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DppProduct = {
  registeredId?: string;
  batchNumber?: string;
  serialNumber?: string;
  producedByParty?: { registeredId?: string };
  producedAtFacility?: { registeredId?: string };
};

type ConformityClaim = {
  referenceStandard?: { id?: string };
  referenceRegulation?: { id?: string };
  assessmentCriteria?: { id?: string }[];
};

type DppSubject = {
  product?: DppProduct;
  conformityClaim?: ConformityClaim[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDppRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dpp = subject as DppSubject;
  const product = dpp.product;
  if (!product) return { ...EMPTY_REFS };

  const refs: ExtractedRefs = { organisations: [], facilities: [], products: [] };

  if (product.registeredId) {
    refs.products.push({
      id: product.registeredId,
      ...(product.batchNumber && { batchNumber: product.batchNumber }),
      ...(product.serialNumber && { serialNumber: product.serialNumber }),
    });
  }

  if (product.producedByParty?.registeredId) {
    refs.organisations.push({ id: product.producedByParty.registeredId });
  }

  if (product.producedAtFacility?.registeredId) {
    refs.facilities.push({ id: product.producedAtFacility.registeredId });
  }

  if (dpp.conformityClaim && dpp.conformityClaim.length > 0) {
    const standardUrls: string[] = [];
    const regulationUrls: string[] = [];
    const criteriaUrls: string[] = [];

    for (const claim of dpp.conformityClaim) {
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
