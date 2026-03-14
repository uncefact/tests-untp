import type { VersionSpec } from '../../../types.js';
import { buildDccSubject } from '../builder.js';
import { extractDccRefs } from '../extractor.js';

export const dccV060Spec: VersionSpec = {
  builder: buildDccSubject,
  extractor: extractDccRefs,
};
