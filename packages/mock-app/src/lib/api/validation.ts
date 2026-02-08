/**
 * Reusable input validation utilities for API routes.
 *
 * Functions throw ValidationError on invalid input.
 * Routes catch ValidationError and return 400.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate that a value is one of the permitted enum values.
 * Returns the value unchanged if valid, throws if not.
 * Skips validation if value is undefined (optional param not provided).
 */
export function validateEnum<T extends string>(
  value: string | undefined,
  permitted: readonly T[],
  paramName: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(permitted as readonly string[]).includes(value)) {
    throw new ValidationError(
      `${paramName} must be one of: ${permitted.join(", ")}`,
    );
  }
  return value as T;
}

/**
 * Parse a string as a positive integer (>= 1).
 * Returns undefined if the raw value is null/undefined.
 */
/**
 * Check that a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parsePositiveInt(
  raw: string | null | undefined,
  paramName: string,
): number | undefined {
  if (raw == null) return undefined;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(`${paramName} must be a positive integer`);
  }
  return parsed;
}

/**
 * Parse a string as a non-negative integer (>= 0).
 * Returns undefined if the raw value is null/undefined.
 */
export function parseNonNegativeInt(
  raw: string | null | undefined,
  paramName: string,
): number | undefined {
  if (raw == null) return undefined;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(
      `${paramName} must be a non-negative integer`,
    );
  }
  return parsed;
}
