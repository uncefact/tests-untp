import { z } from 'zod';
import { idSchema, locationSchema, nonEmptyArraySchema, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * A single organisation item within the POST /organisations bulk-create array.
 *
 * `description` rejects an explicit `null` on create (equivalent to omitting
 * the field): there is nothing to clear yet on a brand-new record, so create
 * has no null-to-clear contract for any field.
 *
 * `location` is an open JSON object (a UNTP-shaped location schema is a
 * separate deferred design tracked in #804) but is not nullable: the
 * generated Prisma client types every create/update `location` argument as
 * `NullableJsonNullValueInput | InputJsonValue`, which excludes a plain
 * `null` (clearing a Json column requires the `Prisma.DbNull`/`Prisma.JsonNull`
 * sentinels), so a literal `null` here would reach Prisma's runtime argument
 * validation and surface as a 500 rather than a 400.
 */
const organisationItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  location: locationSchema.optional(),
  primaryIdentifierId: idSchema.optional(),
  secondaryIdentifierIds: z.array(idSchema).optional(),
});

/** Request body for POST /organisations: a non-empty array of organisation items. */
export const createOrganisationsRequestSchema = nonEmptyArraySchema(organisationItemSchema);

/**
 * Request body for PATCH /organisations/{id}. An empty `secondaryIdentifierIds`
 * array clears all secondary identifiers. `description` is a nullable scalar
 * column, and the pre-migration path forwarded an explicit `null` as a
 * working clear, so `.nullable()` preserves that. `location` is not
 * nullable; see organisationItemSchema for why a literal `null` is rejected
 * here.
 */
export const updateOrganisationRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).nullable().optional(),
    location: locationSchema.optional(),
    primaryIdentifierId: idSchema.nullable().optional(),
    secondaryIdentifierIds: z.array(idSchema).optional(),
  }),
  'At least one updatable field must be provided',
);

/** Query parameters for GET /organisations. Merges the `search` filter ahead of pagination (ADR-037). */
export const listOrganisationsQuerySchema = z
  .object({
    search: z.string().optional(),
  })
  .merge(paginationQuerySchema);
