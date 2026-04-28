import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type PartyRole = {
  role?: string;
  party?: { registeredId?: string };
};

type PerformanceClaim = {
  referenceStandard?: { id?: string }[];
  referenceRegulation?: { id?: string }[];
  referenceCriteria?: { id?: string }[];
};

type DppSubject = {
  type?: string[];
  id?: string;
  batchNumber?: string;
  itemNumber?: string;
  producedAtFacility?: { registeredId?: string };
  relatedParty?: PartyRole[];
  performanceClaim?: PerformanceClaim[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDppRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dpp = subject as DppSubject;

  // In v0.7.0 the credentialSubject IS the Product directly (no wrapper).
  if (!dpp.id) return { ...EMPTY_REFS };

  const refs: ExtractedRefs = { organisations: [], facilities: [], products: [] };

  refs.products.push({
    id: dpp.id,
    ...(dpp.batchNumber && { batchNumber: dpp.batchNumber }),
    ...(dpp.itemNumber && { serialNumber: dpp.itemNumber }),
  });

  if (dpp.relatedParty && dpp.relatedParty.length > 0) {
    for (const pr of dpp.relatedParty) {
      if (pr.party?.registeredId) {
        refs.organisations.push({ id: pr.party.registeredId });
      }
    }
  }

  if (dpp.producedAtFacility?.registeredId) {
    refs.facilities.push({ id: dpp.producedAtFacility.registeredId });
  }

  if (dpp.performanceClaim && dpp.performanceClaim.length > 0) {
    const standardUrls: string[] = [];
    const regulationUrls: string[] = [];
    const criteriaUrls: string[] = [];

    for (const claim of dpp.performanceClaim) {
      if (claim.referenceStandard) {
        for (const s of claim.referenceStandard) {
          if (s.id) standardUrls.push(s.id);
        }
      }
      if (claim.referenceRegulation) {
        for (const r of claim.referenceRegulation) {
          if (r.id) regulationUrls.push(r.id);
        }
      }
      if (claim.referenceCriteria) {
        for (const c of claim.referenceCriteria) {
          if (c.id) criteriaUrls.push(c.id);
        }
      }
    }

    if (standardUrls.length > 0 || regulationUrls.length > 0 || criteriaUrls.length > 0) {
      refs.conformity = { standardUrls, regulationUrls, criteriaUrls };
    }
  }

  return refs;
}
