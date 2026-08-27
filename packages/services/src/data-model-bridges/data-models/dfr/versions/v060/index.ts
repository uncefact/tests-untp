import type { VersionSpec } from '../../../../types.js';
import { buildDfrSubject } from './builder.js';
import { extractDfrRefs } from './extractor.js';
import { extractDfrSubjectSummary } from './subject-summary.js';

export const dfrV060Spec: VersionSpec = {
  builder: buildDfrSubject,
  extractor: extractDfrRefs,
  subjectSummaryExtractor: extractDfrSubjectSummary,
};
