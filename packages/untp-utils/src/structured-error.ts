/**
 * System-wide base class for structured diagnostics, per ADR-035.
 *
 * Sub-entries and consumer packages extend this class with their own typed
 * hierarchies. Lives in `@uncefact/untp-utils` because every workspace
 * package already depends on it; the name is neutral, not utils-specific.
 *
 * @see ../../../docs/adrs/035-utils-throws-structured-errors.md
 */
export interface StructuredDiagnostic {
  /** Stable, namespaced identifier (e.g. `url.private-address`). */
  code: string;
  /** Human-facing summary. */
  message: string;
  /** Failing input or upstream value. */
  received?: unknown;
  /** What was expected. */
  expected?: unknown;
  /** Suggested next step. */
  remediation?: string;
  /** RFC 6901 JSON pointer into the input. */
  pointer?: string;
}

export interface StructuredErrorInit extends StructuredDiagnostic {
  /** Underlying error wrapped via `Error.cause`. */
  cause?: unknown;
}

export class StructuredError extends Error {
  readonly code: string;
  // `declare` keeps these out of the class-field initializer; absent
  // optionals stay absent on the instance (so `'received' in e` is honest).
  declare readonly received?: unknown;
  declare readonly expected?: unknown;
  declare readonly remediation?: string;
  declare readonly pointer?: string;

  constructor(init: StructuredErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.code = init.code;
    if (init.received !== undefined) this.received = init.received;
    if (init.expected !== undefined) this.expected = init.expected;
    if (init.remediation !== undefined) this.remediation = init.remediation;
    if (init.pointer !== undefined) this.pointer = init.pointer;
  }
}

/**
 * Advisory diagnostic returned on the success path of functions that
 * opt into warnings (ADR-035 §5).
 */
export interface StructuredWarning extends StructuredDiagnostic {}

/**
 * One entry in a multi-failure case (e.g. one of N Ajv `allErrors`).
 * Carried on the thrown subclass as `failures: readonly ValidationFailure[]`
 * (ADR-035 §4). Same shape as {@link StructuredWarning}; the type
 * distinguishes fatal sub-failure from advisory at the call site.
 */
export interface ValidationFailure extends StructuredDiagnostic {}
