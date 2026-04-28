import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirror builder output shape) ──────────────────────────────

type EventProduct = {
  product?: { id?: string };
};

type PartyRole = {
  party?: { id?: string; registeredId?: string };
};

type FacilityRef = {
  id?: string;
  registeredId?: string;
};

type DteSubject = {
  // MakeEvent
  inputProduct?: EventProduct[];
  outputProduct?: EventProduct[];
  madeAtFacility?: FacilityRef;
  // ModifyEvent
  modifiedProduct?: EventProduct[];
  modifiedAtFacility?: FacilityRef;
  // MoveEvent
  movedProduct?: EventProduct[];
  fromFacility?: FacilityRef;
  toFacility?: FacilityRef;
  // shared
  relatedParty?: PartyRole[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

function pushProductRefs(list: EventProduct[] | undefined, seen: Set<string>, products: { id: string }[]) {
  if (!list) return;
  for (const ep of list) {
    const id = ep.product?.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      products.push({ id });
    }
  }
}

function facilityId(f: FacilityRef | undefined): string | undefined {
  return f?.registeredId ?? f?.id;
}

export function extractDteRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dte = subject as DteSubject;
  const products: { id: string }[] = [];
  const organisations: { id: string }[] = [];
  const facilities: { id: string }[] = [];
  const seenProductIds = new Set<string>();
  const seenOrgIds = new Set<string>();
  const seenFacilityIds = new Set<string>();

  pushProductRefs(dte.modifiedProduct, seenProductIds, products);
  pushProductRefs(dte.inputProduct, seenProductIds, products);
  pushProductRefs(dte.outputProduct, seenProductIds, products);
  pushProductRefs(dte.movedProduct, seenProductIds, products);

  if (dte.relatedParty) {
    for (const pr of dte.relatedParty) {
      const id = pr.party?.registeredId ?? pr.party?.id;
      if (id && !seenOrgIds.has(id)) {
        seenOrgIds.add(id);
        organisations.push({ id });
      }
    }
  }

  for (const f of [dte.madeAtFacility, dte.modifiedAtFacility, dte.fromFacility, dte.toFacility]) {
    const id = facilityId(f);
    if (id && !seenFacilityIds.has(id)) {
      seenFacilityIds.add(id);
      facilities.push({ id });
    }
  }

  return { organisations, facilities, products };
}
