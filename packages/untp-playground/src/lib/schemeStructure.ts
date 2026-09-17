import {
  ConformitySchemeParseError,
  ConformityUnsupportedSpecVersionError,
  parseConformityScheme,
} from '@uncefact/untp-utils/conformity-vocabulary';
import type { ConformityScheme } from '@uncefact/untp-utils/conformity-vocabulary';
import type { ValidationFailure } from '@uncefact/untp-utils';
import type { DisplayableError } from '@/types/validation';
import type { TestStep } from '@/types';
import { TestCaseStepId } from '../../constants';

export type SchemeStructuralParseDetails = {
  errors: DisplayableError[];
  diagnostics: readonly ValidationFailure[];
  skipped?: true;
  blockedBy?: TestCaseStepId;
};

export type SchemeStructureResult =
  | { kind: 'parsed'; scheme: ConformityScheme }
  | {
      kind: 'document-failure';
      errors: [DisplayableError, ...DisplayableError[]];
      diagnostics: readonly [ValidationFailure, ...ValidationFailure[]];
    }
  | {
      kind: 'unsupported-version';
      received: string;
      expected: readonly string[];
      message: string;
      supportable: true;
    }
  | { kind: 'unexpected'; message: string; supportable: true };

/** Maps parser failures to the details stored on the Structural Parse step; parsed results need no details. */
export function toSchemeStructuralParseDetails(result: Extract<SchemeStructureResult, { kind: 'parsed' }>): undefined;
export function toSchemeStructuralParseDetails(
  result: Exclude<SchemeStructureResult, { kind: 'parsed' }>,
): SchemeStructuralParseDetails;
export function toSchemeStructuralParseDetails(result: SchemeStructureResult): SchemeStructuralParseDetails | undefined;
export function toSchemeStructuralParseDetails(
  result: SchemeStructureResult,
): SchemeStructuralParseDetails | undefined {
  switch (result.kind) {
    case 'parsed':
      return undefined;
    case 'document-failure':
      return { errors: result.errors, diagnostics: result.diagnostics };
    case 'unsupported-version':
      return {
        errors: [{ message: result.message, supportable: result.supportable }],
        diagnostics: [
          {
            code: 'conformity-scheme.unsupported-spec-version',
            message: result.message,
            received: result.received,
            expected: result.expected,
          },
        ],
      };
    case 'unexpected':
      return {
        errors: [{ message: result.message, supportable: result.supportable }],
        diagnostics: [],
      };
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled scheme structure kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Reads details written for the Structural Parse step and rejects unrelated or incomplete step data. */
export function schemeStructuralParseDetails(step: TestStep): SchemeStructuralParseDetails | undefined {
  if (step.id !== TestCaseStepId.SCHEME_STRUCTURAL_PARSE) return undefined;
  const details = step.details as
    | Partial<Record<'errors' | 'diagnostics' | 'skipped' | 'blockedBy', unknown>>
    | undefined;
  if (!details || !Array.isArray(details.errors) || !Array.isArray(details.diagnostics)) return undefined;
  if (details.skipped !== undefined && details.skipped !== true) return undefined;
  return details as SchemeStructuralParseDetails;
}

/**
 * Adapts the conformity-vocabulary parser's throwing contract to a total result for the
 * Playground pipeline: every input, including a non-Error throw, yields one of the four kinds.
 *
 * `sourceUrl` is recorded on the parsed object only. Callers may pass a synthetic URI for
 * source-less inputs while no consumer persists or displays that object; a consumer that does
 * must supply a real source instead.
 *
 * The parser's `parse-failed` diagnostic is the utils build's internal-invariant signature. It is
 * classified as unexpected, rather than as a document failure, so a future parser defect cannot
 * be presented as an uploader-correctable field error.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 */
export function parseSchemeStructure(
  doc: unknown,
  options: { sourceUrl: string; specVersion: string },
): SchemeStructureResult {
  try {
    return { kind: 'parsed', scheme: parseConformityScheme(doc, options) };
  } catch (error) {
    if (error instanceof ConformitySchemeParseError) return documentFailure(error);
    if (error instanceof ConformityUnsupportedSpecVersionError) return unsupportedVersion(error);
    return unexpected(error);
  }
}

/** Describes an unexpected parser failure without exposing an unhelpful `[object Object]` value. */
export function describeUnexpectedSchemeParse(error: unknown): string {
  let cause: string | undefined;
  if (error instanceof Error) {
    try {
      cause = error.message || undefined;
    } catch {
      cause = undefined;
    }
  }

  if (!cause) {
    try {
      cause = JSON.stringify(error) ?? undefined;
    } catch {
      cause = undefined;
    }
  }

  if (!cause) {
    try {
      cause = String(error);
    } catch {
      cause = 'an object without a useful description';
    }
  }

  if (cause === '[object Object]') cause = 'an object without a useful description';
  return `The Playground could not complete this check: ${cause}${
    cause.endsWith('.') ? '' : '.'
  } Report this to the operator.`;
}

function documentFailure(error: ConformitySchemeParseError): SchemeStructureResult {
  const diagnostics = [...error.failures];
  const [first, ...rest] = diagnostics;
  if (!first || (rest.length === 0 && first.code === 'conformity-scheme.parse-failed')) {
    return unexpected(error);
  }

  return {
    kind: 'document-failure',
    errors: [first, ...rest].map((failure) => ({
      message: `${failure.pointer || 'document root'}: ${failure.message}`,
      supportable: false,
    })) as [DisplayableError, ...DisplayableError[]],
    diagnostics: [first, ...rest] as readonly [ValidationFailure, ...ValidationFailure[]],
  };
}

function unsupportedVersion(error: ConformityUnsupportedSpecVersionError): SchemeStructureResult {
  const received = error.received;
  const expected = error.expected;
  // The pipeline passes a detected version, so 'undetected' is unreachable here; the copy names
  // received and expected, so any shape that cannot be named falls back to the unexpected kind.
  if (
    typeof received !== 'string' ||
    received === 'undetected' ||
    !Array.isArray(expected) ||
    !expected.every((version): version is string => typeof version === 'string')
  ) {
    return unexpected(error);
  }

  return {
    kind: 'unsupported-version',
    received,
    expected,
    message: `CVC spec version '${received}' is not supported by the Playground.`,
    supportable: true,
  };
}

function unexpected(error: unknown): SchemeStructureResult {
  return {
    kind: 'unexpected',
    message: describeUnexpectedSchemeParse(error),
    supportable: true,
  };
}
