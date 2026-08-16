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
 * A required text value that must carry real content: `.min(1)` counts
 * characters, not content, so on its own it accepts a whitespace-only value
 * like ' ' and produces a record with a blank name, key, or description.
 * Rejected rather than trimmed: stored values stay verbatim across these
 * APIs, so a value with padding around real content is accepted as sent.
 */
export const nonBlankString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must not be only whitespace',
  });

/**
 * A stored URL field.
 *
 * `.url()` here is WHATWG `new URL` parsing, not RFC 3986 validation (it
 * accepts a value RFC 3986 forbids, e.g. `https://example.com/%`), and is a
 * format check only: any scheme, embedded userinfo permitted, no check that
 * the address is public. A route handler layers `assertHttpUrl` (scheme and
 * userinfo) and `assertPublicUrl` (SSRF) on top of this after parsing, so do
 * not treat this schema check as the whole contract for a URL field.
 */
export const urlSchema = z
  .string()
  .url({ message: 'must be a valid URL' })
  // WHATWG parsing strips surrounding whitespace before parsing, so a padded
  // value like ' https://gs1.org ' passes `.url()` (and the handler's
  // assertHttpUrl/assertPublicUrl, which parse the same way) yet would be
  // stored verbatim with the padding intact. The stored value stays verbatim
  // by design (see the route handlers), so padding is rejected rather than
  // silently trimmed.
  .refine((value) => value === value.trim(), { message: 'must not have leading or trailing whitespace' });

/**
 * A signed 32-bit integer, matching a Prisma `Int`/Postgres int4 column, so
 * an out-of-range value is a 400 at the boundary rather than a 500 from the
 * database. A consumer narrows this further where the column has its own
 * constraint (e.g. the scheme qualifier `order` field applies `.min(0)` on
 * top of this, since a qualifier's position cannot be negative). The
 * services package cannot import this schema (it does not depend on this
 * package), so its response schema for the same column
 * (`schemeQualifierSchema.order` in identity-resolver/schemas.ts) inlines the
 * same (narrowed) bounds; keep the two in sync if either range ever changes.
 */
export const int32Schema = z.number().int().min(-2147483648).max(2147483647);

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
 *
 * Checks only the schema's own recognised keys, not every key present on the
 * raw body: a body whose only key is unrecognised (e.g. a typo'd field name)
 * would otherwise satisfy this precondition, get stripped to `{}` by the
 * wrapped schema's default unknown-key behaviour, and return a silent no-op
 * 200 instead of a 400.
 */
export function requireAtLeastOneField<Schema extends z.SomeZodObject>(schema: Schema, message: string) {
  return z.preprocess((raw, ctx) => {
    const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
    if (isPlainObject) {
      const record = raw as Record<string, unknown>;
      const hasRecognisedField = Object.keys(schema.shape).some((key) => record[key] !== undefined);
      if (!hasRecognisedField) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
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
 * RFC 5646 `Language-Tag` well-formedness (BCP 47), covering the grammar's
 * three alternatives: ordinary langtags (language, optional extlang chain,
 * script, region, variants, extensions, private-use suffix), private-use-only
 * tags (`x-default`), and the RFC's closed grandfathered list (`en-GB-oed`,
 * `i-default`, ...). Case-insensitive, as the RFC specifies. Well-formedness
 * only: subtags are not checked against the IANA registry, and the value is
 * neither canonicalised nor transformed, so what the caller sent is what is
 * stored and published.
 *
 * Deliberately not `Intl.getCanonicalLocales`/`Intl.Locale`: those implement
 * Unicode locale identifiers, a strict subset of BCP 47 that rejects valid
 * private-use-only and grandfathered tags, and they throw (a naive refine
 * would surface a 500 where the contract requires a 400).
 *
 * @see https://www.rfc-editor.org/rfc/rfc5646.html#section-2.1
 */
const BCP47_LANGUAGE_TAG =
  /^(?:(?:en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(?:art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang)|(?:(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*(?:-[a-wy-z0-9](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?)|(?:x(?:-[a-z0-9]{1,8})+))$/i;

/**
 * RFC 5646's grammar allows a subtag sequence the same document then forbids:
 * a variant must not repeat (section 2.2.5) and an extension singleton must
 * not repeat (section 2.2.6). Both are checked after the grammar match, so
 * `de-DE-1901-1901` and `en-a-bbb-a-ccc` are rejected rather than reaching
 * issuance.
 */
function hasUniqueVariantsAndSingletons(tag: string): boolean {
  const subtags = tag.toLowerCase().split('-');
  // A private-use-only tag carries no variants or extensions at all
  // (sections 2.2.6 and 2.2.7), so every subtag after the leading `x` is
  // free-form and repetition is legal: `x-a-a` and `x-default-default` are
  // both well-formed.
  if (subtags[0] === 'x') return true;
  const variants = new Set<string>();
  const singletons = new Set<string>();
  let inExtension = false;
  for (let i = 1; i < subtags.length; i += 1) {
    const subtag = subtags[i];
    if (subtag.length === 1) {
      if (subtag === 'x') return true; // private use runs to the end
      if (singletons.has(subtag)) return false;
      singletons.add(subtag);
      inExtension = true;
      continue;
    }
    if (inExtension) continue; // extension payload, not a variant
    const isVariant = subtag.length >= 5 || (subtag.length === 4 && /^\d/.test(subtag));
    if (isVariant) {
      if (variants.has(subtag)) return false;
      variants.add(subtag);
    }
  }
  return true;
}

export const bcp47TagSchema = z
  .string()
  .regex(BCP47_LANGUAGE_TAG, 'must be a well-formed BCP 47 language tag')
  .refine(hasUniqueVariantsAndSingletons, { message: 'must be a well-formed BCP 47 language tag' })
  .describe('A well-formed BCP 47 (RFC 5646) language tag, e.g. "en", "en-AU", or "x-default".');

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
