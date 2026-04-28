import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DiaSubject = {
  id?: string;
  registeredName?: string;
  registeredId?: string;
  registerType?: string;
};

// ── Public extractor ──────────────────────────────────────────────────────────

const EMPTY_REFS: ExtractedRefs = { organisations: [], facilities: [], products: [] };

export function extractDiaRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return { ...EMPTY_REFS };

  const dia = subject as DiaSubject;

  if (!dia.registeredId) return { ...EMPTY_REFS };

  const ref = { id: dia.registeredId };
  const registerType = dia.registerType;

  return {
    organisations: registerType === 'Business' ? [ref] : [],
    facilities: registerType === 'Facility' || registerType === 'Land' ? [ref] : [],
    products: registerType === 'Product' ? [ref] : [],
  };
}
