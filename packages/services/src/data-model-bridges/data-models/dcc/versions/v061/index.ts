import type { VersionSpec } from '../../../../types.js';
import { buildDccSubjectV061 } from './builder.js';
import { extractDccRefs } from '../v060/extractor.js';

export const dccV061Spec: VersionSpec = {
  builder: buildDccSubjectV061,
  extractor: extractDccRefs,
};
