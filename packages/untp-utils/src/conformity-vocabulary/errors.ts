import { StructuredError, type ValidationFailure } from '../structured-error.js';

/**
 * Base for every diagnostic from `@uncefact/untp-utils/conformity-vocabulary`.
 * Catch to handle any conformity-vocabulary failure generically; catch a
 * concrete subclass for specific handling.
 */
export class ConformitySchemeError extends StructuredError {}

/**
 * The document's CVC spec version could not be detected, or is not
 * supported by this build. Fail-fast: parsing aborts before per-field
 * checks run.
 */
export class ConformityUnsupportedSpecVersionError extends ConformitySchemeError {
  constructor(received: string | undefined, supported: readonly string[]) {
    super({
      code: 'conformity-scheme.unsupported-spec-version',
      message:
        received === undefined
          ? "Could not detect CVC spec version from the document's @context, and no override was supplied."
          : `CVC spec version '${received}' is not supported by this build.`,
      received: received ?? 'undetected',
      expected: supported,
      pointer: received === undefined ? '/@context' : undefined,
    });
  }
}

/**
 * The document failed structural parsing. Carries every per-field failure
 * (invalid shape, missing required field) in {@link failures}; each entry
 * has a stable `code` (`'conformity-scheme.invalid-shape'` or
 * `'conformity-scheme.missing-required-field'`) plus the Ajv-style
 * `pointer`, `received`, and `expected`.
 */
export class ConformitySchemeParseError extends ConformitySchemeError {
  readonly failures: readonly ValidationFailure[];
  constructor(failures: readonly ValidationFailure[]) {
    super({
      code: 'conformity-scheme.parse-failed',
      message: `Conformity scheme failed to parse with ${failures.length} failure(s).`,
    });
    this.failures = failures;
  }
}
