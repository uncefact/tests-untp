import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DiaSubject = {
  registeredId?: string;
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDiaRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dia = subject as DiaSubject;

  if (!dia.registeredId) return { ...EMPTY_REFS };

  return {
    organisations: [{ id: dia.registeredId }],
    facilities: [],
    products: [],
  };
}
