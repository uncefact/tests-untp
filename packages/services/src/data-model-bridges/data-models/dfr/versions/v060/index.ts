import type { VersionSpec } from '../../../../types.js';
import { buildDfrSubject } from './builder.js';
import { extractDfrRefs } from './extractor.js';

export const dfrV060Spec: VersionSpec = {
  builder: buildDfrSubject,
  extractor: extractDfrRefs,
};
