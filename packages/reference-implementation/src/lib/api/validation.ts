/**
 * Reusable input validation utilities for API routes.
 *
 * Functions throw ValidationError on invalid input.
 * Routes catch ValidationError and return 400.
 */

import { validatePublicUrl } from '@uncefact/untp-ri-services/server';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
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
    throw new ValidationError(`${paramName} must be one of: ${permitted.join(', ')}`);
  }
  return value as T;
}

/**
 * Check that a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Parse a string as a positive integer (>= 1).
 * Returns undefined if the raw value is null/undefined.
 */
export function parsePositiveInt(raw: string | null | undefined, paramName: string): number | undefined {
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
export function parseNonNegativeInt(raw: string | null | undefined, paramName: string): number | undefined {
  if (raw == null) return undefined;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${paramName} must be a non-negative integer`);
  }
  return parsed;
}

/**
 * Parse a string as a boolean ("true" or "false").
 * Returns undefined if the raw value is null/undefined.
 */
export function parseBooleanString(raw: string | null | undefined, paramName: string): boolean | undefined {
  if (raw == null) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ValidationError(`${paramName} must be "true" or "false"`);
}

/**
 * Validate that a URL string is well-formed and does not point to a private
 * or reserved network address (SSRF protection).
 */
export async function assertPublicUrl(url: string, paramName: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`${paramName} must be a valid URL`);
  }
  try {
    await validatePublicUrl(parsed);
  } catch (e) {
    if (e instanceof Error && e.message.includes('could not be resolved')) {
      throw new ValidationError(`${paramName} hostname could not be resolved`);
    }
    if (e instanceof Error && e.message.includes('private or reserved')) {
      throw new ValidationError(`${paramName} must not point to a private or reserved network address`);
    }
    throw new ValidationError(
      `${paramName} could not be validated: ${e instanceof Error ? e.message : 'unexpected error'}`,
    );
  }
}
