import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types ─────────────────────────────────────────────────────────────

type PartyRole = {
  role?: string;
  party?: { registeredId?: string };
};

type PerformanceClaim = {
  referenceStandard?: { id?: string }[];
  referenceRegulation?: { id?: string }[];
  referenceCriteria?: { id?: string }[];
};

type DfrSubject = {
  type?: string[];
  registeredId?: string;
  relatedParty?: PartyRole[];
  performanceClaim?: PerformanceClaim[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDfrRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  // In v0.7.0 the credentialSubject IS the Facility directly (no wrapper).
  const dfr = subject as DfrSubject;
  const refs: ExtractedRefs = { organisations: [], facilities: [], products: [] };

  if (dfr.registeredId) {
    refs.facilities.push({ id: dfr.registeredId });
  }

  if (dfr.relatedParty && dfr.relatedParty.length > 0) {
    for (const pr of dfr.relatedParty) {
      if (pr.party?.registeredId) {
        refs.organisations.push({ id: pr.party.registeredId });
      }
    }
  }

  if (dfr.performanceClaim && dfr.performanceClaim.length > 0) {
    const standardUrls: string[] = [];
    const regulationUrls: string[] = [];
    const criteriaUrls: string[] = [];

    for (const claim of dfr.performanceClaim) {
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
