export const ConformityWarningCode = {
  SchemeNotFound: 'conformity-scheme.not-found',
  ProfileNotFound: 'conformity-profile.not-found',
  ProfileNotSpecified: 'conformity-profile.not-specified',
  CriterionNotInProfile: 'conformity-criterion.not-in-profile',
  CriterionMissing: 'conformity-criterion.missing',
  CriterionTopicMismatch: 'conformity-criterion.topic-mismatch',
  AssessmentTopicMismatch: 'conformity-assessment.topic-mismatch',
} as const;

export type ConformityWarningCode = (typeof ConformityWarningCode)[keyof typeof ConformityWarningCode];
