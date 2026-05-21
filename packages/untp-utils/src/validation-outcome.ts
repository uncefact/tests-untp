/**
 * Library-agnostic error and warning shape for `@uncefact/untp-utils`.
 *
 * Every sub-entry that emits validation results uses these types. The
 * convention is governed by ADR-034:
 *
 * - `code` is a namespaced, thing-oriented identifier (e.g.
 *   `conformity-scheme.not-found`). Stable.
 * - `message` is a neutral, library-agnostic factual summary. No app concepts.
 * - `received` and `expected` are populated when the function can describe
 *   the mismatch in structured terms.
 * - `pointer` is populated by the library when its inputs let it construct
 *   one unambiguously (Ajv `instancePath`, JSON-LD positions, internal
 *   iteration indices); otherwise the consumer adds it. A library-supplied
 *   pointer is relative to the input the consumer passed in; consumers
 *   re-map by prepending a wrapper path if needed.
 * - `remediation` is almost always consumer-supplied (the library cannot
 *   know the user's audience or app concepts). Libraries may supply it only
 *   when it is plainly derivable from `expected` and uses agnostic language.
 * - `raw` is for wrapping third-party errors (Ajv, jsonld) for tooling.
 *
 * Functions in `@uncefact/untp-utils` do not throw for input-related
 * failures; they return errors in an outcome. The caller decides whether
 * to throw, log, collect across calls, or render inline.
 *
 * @see ADR-034 in `docs/adrs/`.
 */

export interface ValidationError {
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
  pointer?: string;
  remediation?: string;
  raw?: unknown;
}

export interface ValidationWarning {
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
  pointer?: string;
  remediation?: string;
}

/**
 * The shape returned by validators and parsers. Empty `errors` means the
 * operation succeeded on its own terms; `warnings` are advisory either way.
 */
export interface ValidationOutcome {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * The shape returned by parsers. `value` is present iff `errors.length === 0`.
 */
export interface ParseOutcome<T> extends ValidationOutcome {
  value?: T;
}
