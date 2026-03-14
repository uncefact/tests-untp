import type { IDataModelBridge, VersionSpec } from './types.js';

export function makeBridge(spec: VersionSpec): IDataModelBridge {
  return {
    buildSubject(entities) {
      return spec.builder(entities);
    },
    extractRefs(subject) {
      return spec.extractor(subject);
    },
  };
}
