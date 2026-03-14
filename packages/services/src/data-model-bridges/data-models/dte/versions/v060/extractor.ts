import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types ──────────────────────────────────────────────────────────

type DteItem = {
  id?: string;
};

type DteSubject = {
  // ObjectEvent, TransactionEvent
  epcList?: DteItem[];
  // TransformationEvent
  inputEPCList?: DteItem[];
  outputEPCList?: DteItem[];
  // AggregationEvent, AssociationEvent
  parentEPC?: DteItem;
  childEPCList?: DteItem[];
  // TransactionEvent
  sourceParty?: string;
  destinationParty?: string;
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDteRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dte = subject as DteSubject;
  const products: { id: string }[] = [];
  const organisations: { id: string }[] = [];
  const seenProductIds = new Set<string>();

  // ObjectEvent + TransactionEvent: epcList
  if (dte.epcList) {
    for (const item of dte.epcList) {
      if (item.id && !seenProductIds.has(item.id)) {
        seenProductIds.add(item.id);
        products.push({ id: item.id });
      }
    }
  }

  // TransformationEvent: inputEPCList + outputEPCList
  if (dte.inputEPCList) {
    for (const item of dte.inputEPCList) {
      if (item.id && !seenProductIds.has(item.id)) {
        seenProductIds.add(item.id);
        products.push({ id: item.id });
      }
    }
  }
  if (dte.outputEPCList) {
    for (const item of dte.outputEPCList) {
      if (item.id && !seenProductIds.has(item.id)) {
        seenProductIds.add(item.id);
        products.push({ id: item.id });
      }
    }
  }

  // AggregationEvent + AssociationEvent: parentEPC + childEPCList
  if (dte.parentEPC?.id && !seenProductIds.has(dte.parentEPC.id)) {
    seenProductIds.add(dte.parentEPC.id);
    products.push({ id: dte.parentEPC.id });
  }
  if (dte.childEPCList) {
    for (const item of dte.childEPCList) {
      if (item.id && !seenProductIds.has(item.id)) {
        seenProductIds.add(item.id);
        products.push({ id: item.id });
      }
    }
  }

  // TransactionEvent: sourceParty + destinationParty
  const seenOrgIds = new Set<string>();
  if (dte.sourceParty && !seenOrgIds.has(dte.sourceParty)) {
    seenOrgIds.add(dte.sourceParty);
    organisations.push({ id: dte.sourceParty });
  }
  if (dte.destinationParty && !seenOrgIds.has(dte.destinationParty)) {
    seenOrgIds.add(dte.destinationParty);
    organisations.push({ id: dte.destinationParty });
  }

  return {
    organisations,
    facilities: [],
    products,
  };
}
