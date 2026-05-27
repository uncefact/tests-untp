import type { ValidationFailure } from '../structured-error.js';
import { asNonEmptyString } from './as-non-empty-string.js';

/**
 * Returns a `requireString(value, fieldName, pointer, failures)` helper
 * pre-bound to a structured-failure `code`. When `value` is a non-empty
 * string, returns it; otherwise pushes a {@link ValidationFailure} onto
 * `failures` and returns `undefined`.
 *
 * Each parser binds the factory once per file with its sub-entry's
 * missing-required-field code, keeping per-call sites unaware of the code
 * namespace.
 */
export function makeRequireString(code: string) {
  return function requireString(
    value: unknown,
    fieldName: string,
    pointer: string,
    failures: ValidationFailure[],
  ): string | undefined {
    const parsed = asNonEmptyString(value);
    if (parsed !== undefined) return parsed;
    failures.push({
      code,
      message: `${fieldName} is required and must be a non-empty string.`,
      received:
        value === undefined ? 'undefined' : value === null ? 'null' : value === '' ? 'empty string' : typeof value,
      expected: 'non-empty string',
      pointer,
    });
    return undefined;
  };
}
