import type { CredentialSubject, ExtractedRefs } from '../../../../types.js';

// ── Internal types (mirrors builder output shape) ─────────────────────────────

type DiaSubject = {
  registeredId?: string;
};

// ── Public extractor ──────────────────────────────────────────────────────────

export function extractDiaRefs(subject: CredentialSubject): ExtractedRefs {
  if (!subject) return {};

  const dia = subject as DiaSubject;

  if (!dia.registeredId) return {};

  return {
    organisation: { id: dia.registeredId },
  };
}
