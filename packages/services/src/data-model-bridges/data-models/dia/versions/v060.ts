import type { VersionSpec } from '../../../types.js';
import { buildDiaSubject } from '../builder.js';
import { extractDiaRefs } from '../extractor.js';

export const diaV060Spec: VersionSpec = {
  builder: buildDiaSubject,
  extractor: extractDiaRefs,
};
