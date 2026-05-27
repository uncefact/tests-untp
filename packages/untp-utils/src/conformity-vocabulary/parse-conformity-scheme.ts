import { detectVersionFromContext } from '../detect-version-from-context.js';
import type { ValidationFailure } from '../structured-error.js';
import { ConformitySchemeParseError, ConformityUnsupportedSpecVersionError } from './errors.js';
import { parseV070ConformityScheme } from './parsers/v0-7-0.parser.js';
import type { ConformityScheme } from './types.js';

export interface ParseConformitySchemeOptions {
  /** The URL the document was fetched from; recorded on the returned scheme. */
  sourceUrl: string;
  /**
   * Override the CVC spec version detection. When omitted, the version is
   * derived from the document's `@context`.
   */
  specVersion?: string;
}

/** CVC spec versions this build can parse. */
export const SUPPORTED_CVC_SPEC_VERSIONS = ['0.7.0'] as const;
export type SupportedCvcSpecVersion = (typeof SUPPORTED_CVC_SPEC_VERSIONS)[number];

type Parser = (doc: unknown, sourceUrl: string, failures: ValidationFailure[]) => ConformityScheme | undefined;

const PARSERS: Record<SupportedCvcSpecVersion, Parser> = {
  '0.7.0': parseV070ConformityScheme,
};

/**
 * Parses an owner-published conformity scheme JSON-LD document into a
 * structured tree.
 *
 * The spec version is detected from the document's `@context`; the detection
 * can be overridden via `options.specVersion`.
 *
 * @throws {ConformityUnsupportedSpecVersionError} if the version can't be
 *   detected or is not supported by this build (fail-fast).
 * @throws {ConformitySchemeParseError} carrying every accumulated per-field
 *   failure in `failures[]` if the document is structurally invalid.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 */
export function parseConformityScheme(doc: unknown, options: ParseConformitySchemeOptions): ConformityScheme {
  const detected = options.specVersion ?? detectVersionFromContext(doc);
  if (!detected) {
    throw new ConformityUnsupportedSpecVersionError(undefined, SUPPORTED_CVC_SPEC_VERSIONS);
  }

  const parser = PARSERS[detected as SupportedCvcSpecVersion];
  if (!parser) {
    throw new ConformityUnsupportedSpecVersionError(detected, SUPPORTED_CVC_SPEC_VERSIONS);
  }

  const failures: ValidationFailure[] = [];
  const scheme = parser(doc, options.sourceUrl, failures);
  if (failures.length > 0) {
    throw new ConformitySchemeParseError(failures);
  }
  if (!scheme) {
    throw new ConformitySchemeParseError([
      {
        code: 'conformity-scheme.parse-failed',
        message: 'Parser returned no scheme but reported no failures (internal invariant violated).',
      },
    ]);
  }
  return scheme;
}
