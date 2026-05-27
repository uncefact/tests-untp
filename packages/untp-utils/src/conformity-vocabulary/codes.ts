export const ConformityWarningCode = {
  SchemeNotFound: 'conformity-scheme.not-found',
  ProfileNotFound: 'conformity-profile.not-found',
  CriterionNotInProfile: 'conformity-criterion.not-in-profile',
  CriterionMissing: 'conformity-criterion.missing',
  CriterionTopicMismatch: 'conformity-criterion.topic-mismatch',
} as const;

export type ConformityWarningCode = (typeof ConformityWarningCode)[keyof typeof ConformityWarningCode];
