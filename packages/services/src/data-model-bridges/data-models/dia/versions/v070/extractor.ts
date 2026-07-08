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

  // The v0.7.0 registerType code list is lowercase, unlike v0.6.x's capitalised
  // values. See the RegisteredIdentity definition in
  // https://untp.unece.org/artefacts/schema/v0.7.0/dia/DigitalIdentityAnchor.json
  return {
    organisations: registerType === 'business' ? [ref] : [],
    facilities: registerType === 'facility' || registerType === 'land' ? [ref] : [],
    products: registerType === 'product' ? [ref] : [],
  };
}
