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
      return spec.conformityClaimExtractor ? spec.conformityClaimExtractor(subject) : null;
    },
  };
}
