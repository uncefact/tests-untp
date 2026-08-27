import type { VersionSpec } from '../../../../types.js';
import { buildDiaSubject } from './builder.js';
import { extractDiaRefs } from './extractor.js';
import { extractDiaSubjectSummary } from './subject-summary.js';

export const diaV070Spec: VersionSpec = {
  builder: buildDiaSubject,
  extractor: extractDiaRefs,
  subjectSummaryExtractor: extractDiaSubjectSummary,
};
