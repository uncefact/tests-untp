/**
 * Conformity-vocabulary codes are thing-oriented and namespaced by the
 * artefact the code is about (a scheme, a profile, a criterion), not the
 * activity that detected it. Stable; consumers may branch on them with
 * exhaustive switches.
 *
 * @see ADR-034 in `docs/adrs/`.
 */

/**
 * Codes for warnings emitted by {@link validateConformityClaim}.
 *
 * Exported as an `as const` object so callers can reference codes by
 * identifier (e.g. `ConformityWarningCode.SchemeNotFound`) rather than by
 * raw string.
 */
export const ConformityWarningCode = {
  SchemeNotFound: 'conformity-scheme.not-found',
  ProfileNotFound: 'conformity-profile.not-found',
  CriterionNotInProfile: 'conformity-criterion.not-in-profile',
  CriterionMissing: 'conformity-criterion.missing',
  CriterionTopicMismatch: 'conformity-criterion.topic-mismatch',
} as const;

export type ConformityWarningCode = (typeof ConformityWarningCode)[keyof typeof ConformityWarningCode];

/**
 * Codes for errors emitted by {@link parseConformityScheme} when the input
 * document is malformed or unsupported. Errors are returned in
 * `ParseOutcome.errors`, not thrown.
 */
export const ConformitySchemeErrorCode = {
  /** Document is not a non-null object, or a required property has the wrong type. */
  InvalidShape: 'conformity-scheme.invalid-shape',
  /** A required field is missing or empty. */
  MissingRequiredField: 'conformity-scheme.missing-required-field',
  /** The detected (or supplied) CVC spec version is not supported by this build. */
  UnsupportedSpecVersion: 'conformity-scheme.unsupported-spec-version',
} as const;

export type ConformitySchemeErrorCode = (typeof ConformitySchemeErrorCode)[keyof typeof ConformitySchemeErrorCode];
