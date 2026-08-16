import type { VersionSpec } from '../../../../types.js';
import { buildDccSubject } from './builder.js';
import { extractDccRefs } from './extractor.js';
import { extractDccConformityClaim, extractDccConformityClaimWithProvenance } from './conformity-claim.js';

export const dccV070Spec: VersionSpec = {
  builder: buildDccSubject,
  extractor: extractDccRefs,
  conformityClaimExtractor: extractDccConformityClaim,
  conformityClaimProvenanceExtractor: extractDccConformityClaimWithProvenance,
};
