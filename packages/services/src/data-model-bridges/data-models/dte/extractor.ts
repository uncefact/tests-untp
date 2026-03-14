import type { CredentialSubject, ExtractedRefs } from '../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DteItem = {
  id?: string;
  name?: string;
};

type DteSubject = {
  epcList?: DteItem[];
};

// ── Public extractor ──────────────────────────────────────────────────────────

export function extractDteRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return {};

  const dte = subject as DteSubject;
  const epcList = dte.epcList;

  if (!epcList || epcList.length === 0) return {};

  const firstItem = epcList[0];
  if (!firstItem?.id) return {};

  return {
    product: { id: firstItem.id },
  };
}
