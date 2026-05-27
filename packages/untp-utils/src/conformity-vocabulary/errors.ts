import { StructuredError, type ValidationFailure } from '../structured-error.js';

/**
 * Base for every diagnostic from `@uncefact/untp-utils/conformity-vocabulary`
 * (scheme parsing, catalogue parsing, claim validation). Catch to handle any
 * conformity-vocabulary failure generically; catch a concrete subclass for
 * specific handling.
 */
export class ConformityVocabularyError extends StructuredError {}

/**
 * The document's CVC spec version could not be detected, or is not
 * supported by this build. Fail-fast: parsing aborts before per-field
 * checks run.
 */
export class ConformityUnsupportedSpecVersionError extends ConformityVocabularyError {
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
 * The scheme document failed structural parsing. Carries every per-field
 * failure (invalid shape, missing required field) in {@link failures};
 * each entry has a stable `code` (`'conformity-scheme.invalid-shape'` or
 * `'conformity-scheme.missing-required-field'`) plus the Ajv-style
 * `pointer`, `received`, and `expected`.
 */
export class ConformitySchemeParseError extends ConformityVocabularyError {
  readonly failures: readonly ValidationFailure[];
  constructor(failures: readonly ValidationFailure[]) {
    super({
      code: 'conformity-scheme.parse-failed',
      message: `Conformity scheme failed to parse with ${failures.length} failure(s).`,
    });
    this.failures = failures;
  }
}

/**
 * The UNTP Conformity Vocabulary Catalogue Register document failed
 * structural parsing. Carries every per-entry / per-field failure in
 * {@link failures} (codes `'conformity-catalogue.invalid-shape'` or
 * `'conformity-catalogue.missing-required-field'`, with the Ajv-style
 * `pointer`). {@link sourceUrl} is set when the parser was invoked with
 * the URL the register was fetched from, for operator-side triage.
 */
export class ConformityCatalogueParseError extends ConformityVocabularyError {
  readonly failures: readonly ValidationFailure[];
  readonly sourceUrl?: string;
  constructor(args: { failures: readonly ValidationFailure[]; sourceUrl?: string }) {
    super({
      code: 'conformity-catalogue.parse-failed',
      message:
        args.sourceUrl !== undefined
          ? `Conformity catalogue at ${args.sourceUrl} failed to parse with ${args.failures.length} failure(s).`
          : `Conformity catalogue failed to parse with ${args.failures.length} failure(s).`,
    });
    this.failures = args.failures;
    if (args.sourceUrl !== undefined) this.sourceUrl = args.sourceUrl;
  }
}
