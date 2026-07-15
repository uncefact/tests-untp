/**
 * Zod request-body and query-parameter schemas shared across resources
 * (ADR-037).
 *
 * Routes parse bodies with parseRequestBody and query parameters with
 * parseQueryParams, both from '@/lib/api/validation', and import schemas
 * from the resource file directly (no barrel index; a barrel transitively
 * loads every resource's dependencies, which breaks tests that mock those
 * packages). Schemas validate shape and type only; referential checks
 * (existence, tenant scoping) stay in repositories and services.
 *
 * Never annotate a schema export with a wide type such as z.ZodTypeAny:
 * the annotation silently erases z.infer<Schema> to any with no compiler
 * signal that inference broke. Leave a schema export's type inferred, or
 * use `satisfies` where an explicit check is wanted.
 */

import { z } from 'zod';

import { MAX_PAGE_LIMIT } from '@/lib/api/pagination';

/** A database identifier reference (non-empty string). */
export const idSchema = z.string().min(1);

/**
 * UNTP location object, accepted as an open JSON object. No field-level
 * validation is applied anywhere today; a UNTP-shaped location schema is
 * tracked in #804.
 */
export const locationSchema = z.record(z.unknown());

/**
 * Wraps an update-body schema so a body providing no fields is rejected.
 * Checks the raw input's own values before the wrapped schema applies any
 * defaults, so a body of `{}` (or a body whose only keys are explicitly
 * `undefined`) is rejected even when every field carries a `.default()`;
 * checking the parsed output instead would let a default mask an empty
 * body. A non-object raw body is left untouched so the wrapped schema's own
 * type check produces its usual "Expected object, received X" message.
 */
export function requireAtLeastOneField<Schema extends z.SomeZodObject>(schema: Schema, message: string) {
  return z.preprocess((raw, ctx) => {
    const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
    if (isPlainObject && !Object.values(raw as object).some((value) => value !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return raw;
  }, schema);
}

/** A bulk-create request body: a non-empty array of items. */
export function nonEmptyArraySchema<Item extends z.ZodTypeAny>(itemSchema: Item) {
  return z
    .array(itemSchema, { invalid_type_error: 'Request body must be an array' })
    .min(1, 'Request body must not be empty');
}

/**
 * Coerces a trimmed query-string value to a strict decimal integer, subject
 * to the given range check. Accepts only an optional leading sign followed
 * by one or more digits (`5`, `+5`, ` 5 ` once trimmed); rejects everything
 * a plain integer literal is not, including fractional (`5.5`, `5.0`),
 * scientific (`1e3`), and hex/binary/octal forms (`0x10`, `0b101`, `0o17`),
 * trailing garbage (`1abc`), and empty or whitespace-only strings. A
 * missing key stays `undefined` via the trailing `.optional()`, which
 * short-circuits before any of this runs.
 *
 * This deliberately tightens behaviour versus the parseInt-based
 * parsePositiveInt/parseNonNegativeInt helpers in '@/lib/api/validation'
 * that this fragment replaces as resources adopt it: parseInt with radix
 * 10 parses only a value's leading digits, so it silently accepted
 * malformed input such as "1abc" (as 1) and "0x10" (as 0, itself wrongly
 * valid as a non-negative offset).
 *
 * A digit string too large for an exact double is rejected: the safe-integer
 * check catches both a value that overflows to Infinity (which passes a bare
 * range check) and a value above Number.MAX_SAFE_INTEGER that Number would
 * round to a different integer than the client sent.
 */
function strictIntQueryParam(message: string, isInRange: (value: number) => boolean) {
  return z
    .string()
    .trim()
    .regex(/^[+-]?\d+$/, message)
    .transform((value) => Number(value))
    .refine((value) => Number.isSafeInteger(value) && isInRange(value), message)
    .optional();
}

/**
 * Shared `limit`/`offset` query fragment for list routes (ADR-037).
 *
 * `limit` above MAX_PAGE_LIMIT is rejected rather than clamped, so a client
 * that asks for more than the maximum is told the bound rather than handed a
 * quietly smaller page (issue #834).
 *
 * A resource merges this onto its own filter schema, pagination last, so a
 * resource's own filter issue is reported before a pagination issue when
 * both are invalid (parseQueryParams renders only the first issue, and
 * this ordering matches what current routes already report):
 *
 *   const resourceQuerySchema = z.object({ status: z.enum([...]) }).merge(paginationQuerySchema);
 *   const query = parseQueryParams(new URL(req.url), resourceQuerySchema);
 */
export const paginationQuerySchema = z.object({
  limit: strictIntQueryParam('must be a positive integer', (value) => value >= 1).refine(
    (value) => value === undefined || value <= MAX_PAGE_LIMIT,
    `must not exceed the maximum of ${MAX_PAGE_LIMIT}`,
  ),
  offset: strictIntQueryParam('must be a non-negative integer', (value) => value >= 0),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Shared boolean query-parameter schema, accepting exactly "true" or
 * "false" (case-sensitive) and rejecting everything else, matching the
 * parseBooleanString helper in '@/lib/api/validation' that this replaces
 * as resources adopt it. Deliberately not `z.coerce.boolean()`: that
 * coercion treats any non-empty string, including "false" and "0", as
 * truthy, which would accept exactly the malformed input this schema
 * exists to reject.
 */
export const booleanQuerySchema = z
  .enum(['true', 'false'], { message: 'must be "true" or "false"' })
  .transform((value) => value === 'true')
  .optional();
