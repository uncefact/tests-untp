/**
 * Reusable input validation utilities for API routes.
 *
 * Functions throw ValidationError on invalid input.
 * Routes catch ValidationError and return 400.
 */

import { z } from 'zod';
import { validatePublicUrl } from '@uncefact/untp-ri-services/server';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Parse and validate a JSON request body against a Zod schema (ADR-037).
 *
 * Malformed JSON, a literal `null` body, and any shape mismatch throw
 * ValidationError with the first issue rendered as `field.path: message`,
 * which the route error mapper returns as a 400.
 */
export async function parseRequestBody<Schema extends z.ZodTypeAny>(
  req: { json: () => Promise<unknown> },
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
  // Checked explicitly rather than left to safeParse: a schema that accepts
  // any shape (e.g. z.unknown()) would otherwise treat a literal `null` body
  // as valid data instead of a malformed request.
  if (raw === null) {
    throw new ValidationError('body: Expected object, received null');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(`${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return parsed.data;
}

/**
 * Parse and validate URL query parameters against a Zod schema (ADR-037).
 *
 * Accepts either a URLSearchParams or the route's URL directly. Rejects a
 * query key that appears more than once (e.g. `?status=a&status=b`), since
 * a resource's query schema declares each parameter as a single scalar; a
 * multi-value/array query parameter path is deferred until a resource needs
 * one. Coerces and validates the declared parameters, throwing
 * ValidationError with the first issue rendered as `param: message` on
 * failure so body and query 400s look identical (mirrors parseRequestBody's
 * rendering convention).
 */
export function parseQueryParams<Schema extends z.ZodTypeAny>(
  source: URL | URLSearchParams,
  schema: Schema,
): z.infer<Schema> {
  const searchParams = source instanceof URL ? source.searchParams : source;
  const seenKeys = new Set<string>();
  for (const key of searchParams.keys()) {
    if (seenKeys.has(key)) {
      throw new ValidationError(`${key}: repeated query parameter`);
    }
    seenKeys.add(key);
  }
  const raw = Object.fromEntries(searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(`${issue.path.join('.') || 'param'}: ${issue.message}`);
  }
  return parsed.data;
}

/**
 * Returns a copy of the object containing only the keys whose value is not
 * undefined, preserving optionality in the result type. Forwards a parsed
 * PATCH body to a repository update input without per-field conditional
 * spreads at every call site.
 */
export function definedFields<T extends object>(source: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
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
 * Assert that a string is a well-formed, absolute http(s) URL that carries no
 * userinfo, returning the parsed {@link URL}. Throws a {@link ValidationError}
 * otherwise.
 *
 * This is the scheme and well-formedness check, independent of the SSRF
 * private-address check in {@link assertPublicUrl}. It is applied to
 * caller-supplied URLs regardless of `VERIFY_ALLOW_PRIVATE_URLS`, since that
 * flag relaxes the private-network check for local development, not the
 * requirement that a published URL be a usable, safe http(s) address. Userinfo
 * (a `user:pass@` component) is rejected because such a URL may be published to
 * a public directory, which would leak the embedded credential.
 */
export function assertHttpUrl(url: string, paramName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`${paramName} must be a valid absolute http(s) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`${paramName} must be an http(s) URL`);
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError(`${paramName} must not contain a username or password`);
  }
  return parsed;
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
