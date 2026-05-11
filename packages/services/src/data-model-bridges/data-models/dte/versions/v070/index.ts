import type { VersionSpec } from '../../../../types.js';
import { buildDteSubject } from './builder.js';
import { extractDteRefs } from './extractor.js';

export const dteV070Spec: VersionSpec = {
  builder: buildDteSubject,
  extractor: extractDteRefs,
};
