import { detectVersionFromContext } from '../detect-version-from-context.js';
import type { ParseOutcome } from '../validation-outcome.js';
import { ConformitySchemeErrorCode } from './codes.js';
import { parseV070ConformityScheme } from './parsers/v0-7-0.parser.js';
import type { ConformityScheme, ConformitySchemeError } from './types.js';

/**
 * Options for {@link parseConformityScheme}.
 */
export interface ParseConformitySchemeOptions {
  /** The URL the document was fetched from; recorded on the returned scheme. */
  sourceUrl: string;
  /**
   * Override the CVC spec version detection. When omitted, the version is
   * derived from the document's `@context`. Useful for testing or when a
   * draft document's `@context` is ambiguous.
   */
  specVersion?: string;
}

/** CVC spec versions this build can parse. */
export const SUPPORTED_CVC_SPEC_VERSIONS = ['0.7.0'] as const;
export type SupportedCvcSpecVersion = (typeof SUPPORTED_CVC_SPEC_VERSIONS)[number];

type Parser = (doc: unknown, sourceUrl: string, errors: ConformitySchemeError[]) => ConformityScheme | undefined;

const PARSERS: Record<SupportedCvcSpecVersion, Parser> = {
  '0.7.0': parseV070ConformityScheme,
};

/**
 * Parses an owner-published conformity scheme JSON-LD document into a
 * structured tree.
 *
 * The spec version is detected from the document's `@context` (UNTP publishes
 * versioned context URLs at `https://vocabulary.uncefact.org/untp/{version}/context/`).
 * The detection can be overridden via `options.specVersion`.
 *
 * Per ADR-034, this function does not throw for input-related failures. All
 * errors (malformed shape, missing required fields, unsupported spec
 * version) are returned in the outcome's `errors` array. `value` is present
 * iff `errors` is empty.
 *
 * @param doc - The parsed JSON-LD document.
 * @param options - `sourceUrl` is required; `specVersion` is optional.
 * @returns A `ParseOutcome` carrying the structured scheme on success or
 *   an array of structured errors on failure.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 */
export function parseConformityScheme(
  doc: unknown,
  options: ParseConformitySchemeOptions,
): ParseOutcome<ConformityScheme> {
  const errors: ConformitySchemeError[] = [];
  const warnings: never[] = [];

  const detected = options.specVersion ?? detectVersionFromContext(doc);
  if (!detected) {
    errors.push({
      code: ConformitySchemeErrorCode.UnsupportedSpecVersion,
      message: "Could not detect CVC spec version from the document's @context, and no override was supplied.",
      received: 'undetected',
      expected: [...SUPPORTED_CVC_SPEC_VERSIONS],
      pointer: '/@context',
    });
    return { errors, warnings };
  }

  const parser = PARSERS[detected as SupportedCvcSpecVersion];
  if (!parser) {
    errors.push({
      code: ConformitySchemeErrorCode.UnsupportedSpecVersion,
      message: `CVC spec version '${detected}' is not supported by this build.`,
      received: detected,
      expected: [...SUPPORTED_CVC_SPEC_VERSIONS],
    });
    return { errors, warnings };
  }

  const value = parser(doc, options.sourceUrl, errors);
  if (errors.length > 0 || !value) {
    return { errors, warnings };
  }
  return { value, errors, warnings };
}
