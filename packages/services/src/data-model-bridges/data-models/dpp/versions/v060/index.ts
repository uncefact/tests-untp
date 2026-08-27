import type { VersionSpec } from '../../../../types.js';
import { buildDppSubject } from './builder.js';
import { extractDppRefs } from './extractor.js';
import { extractDppSubjectSummary } from './subject-summary.js';

export const dppV060Spec: VersionSpec = {
  builder: buildDppSubject,
  extractor: extractDppRefs,
  subjectSummaryExtractor: extractDppSubjectSummary,
};
