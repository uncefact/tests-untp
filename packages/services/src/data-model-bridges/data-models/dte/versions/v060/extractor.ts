import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DteItem = {
  id?: string;
  name?: string;
};

type DteSubject = {
  epcList?: DteItem[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDteRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dte = subject as DteSubject;
  const epcList = dte.epcList;

  if (!epcList || epcList.length === 0) return { ...EMPTY_REFS };

  const firstItem = epcList[0];
  if (!firstItem?.id) return { ...EMPTY_REFS };

  return {
    organisations: [],
    facilities: [],
    products: [{ id: firstItem.id }],
  };
}
