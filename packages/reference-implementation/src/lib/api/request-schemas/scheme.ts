import { z } from 'zod';
import { idSchema, int32Schema, nonBlankString, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * A scheme or qualifier validation pattern, checked to compile as a regular
 * expression (ADR-037). This is a well-formedness check only; ReDoS
 * protection against a pattern that compiles but is pathologically slow to
 * evaluate is a separate concern tracked in #463.
 */
const validationPatternSchema = z
  .string()
  .min(1)
  .refine(
    (pattern) => {
      try {
        new RegExp(pattern);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be a valid regular expression' },
  );

/**
 * A qualifier definition nested under a scheme's `qualifiers` array. `order`
 * is left optional here to match the repository, which defaults an omitted
 * order to 0 via the Prisma column default rather than the schema. `order`
 * is a non-negative position for URI resolution (ascending, from 0); the
 * upper bound matches the int4 range of the underlying Postgres column, so
 * an out-of-range value is a 400 at the boundary rather than a 500 from the
 * database.
 */
const schemeQualifierInputSchema = z.object({
  key: nonBlankString,
  description: nonBlankString,
  validationPattern: validationPatternSchema,
  order: int32Schema.min(0).optional(),
});

/** Request body for POST /schemes. */
export const createSchemeRequestSchema = z.object({
  registrarId: idSchema,
  name: nonBlankString,
  primaryKey: nonBlankString,
  // validationPattern keeps its own schema rather than nonBlankString: a
  // whitespace-only pattern is a well-formed regular expression, and the
  // regex-compile refinement is the contract for this field.
  validationPattern: validationPatternSchema,
  // Not a URL: an ISO 18975 link template such as "/{primaryKey}/{value}".
  linkTemplate: nonBlankString,
  idrServiceInstanceId: idSchema.optional(),
  qualifiers: z.array(schemeQualifierInputSchema).optional(),
});

/** Request body for PATCH /schemes/{id}. Replaces the qualifiers array wholesale when provided. */
export const updateSchemeRequestSchema = requireAtLeastOneField(
  z.object({
    name: nonBlankString.optional(),
    primaryKey: nonBlankString.optional(),
    validationPattern: validationPatternSchema.optional(),
    linkTemplate: nonBlankString.optional(),
    idrServiceInstanceId: idSchema.nullable().optional(),
    qualifiers: z.array(schemeQualifierInputSchema).optional(),
  }),
  'At least one field is required',
);

/**
 * Query parameters for GET /schemes. Merges the `registrarId` filter ahead
 * of pagination so a malformed filter is reported before a pagination issue
 * (ADR-037).
 */
export const listSchemesQuerySchema = z
  .object({
    registrarId: idSchema.optional(),
  })
  .merge(paginationQuerySchema);
