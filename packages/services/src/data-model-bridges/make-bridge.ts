import type { IDataModelBridge, VersionSpec } from './types.js';

export function makeBridge(spec: VersionSpec): IDataModelBridge {
  return {
    buildSubject(entities) {
      return spec.builder(entities);
    },
    extractRefs(subject) {
      return spec.extractor(subject);
    },
    extractConformityClaim(subject) {
      if (spec.conformityClaimExtractor) return spec.conformityClaimExtractor(subject);
      // A version may supply only the provenance extractor; the claim it
      // projects is the same one, so this method reports it rather than
      // claiming the credential carries none.
      return spec.conformityClaimProvenanceExtractor?.(subject)?.claim ?? null;
    },
    extractConformityClaimWithProvenance(subject) {
      if (spec.conformityClaimProvenanceExtractor) {
        return spec.conformityClaimProvenanceExtractor(subject);
      }
      // A version that extracts a claim but records no provenance still gets
      // its claim validated; it just yields no pointers, because an empty map
      // leaves the consumer nothing to substitute. Returning null here instead
      // would skip conformity validation altogether for that version, which is
      // a worse failure than the missing pointers this exists to supply.
      const claim = spec.conformityClaimExtractor?.(subject) ?? null;
      return claim ? { claim, sourceMap: {} } : null;
    },
  };
}
