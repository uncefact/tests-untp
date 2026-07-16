import { z } from 'zod';
import { idSchema, locationSchema, nonEmptyArraySchema, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * A single item in the POST /facilities bulk-create request body.
 *
 * `description` is validated as a non-empty string per ADR-037 decision
 * point 5 (an open-vocabulary/free-text field stays a validated non-empty
 * string rather than tightened further, with the reason recorded at the
 * field: free text has no closed, checkable format to tighten to).
 *
 * None of this item's optional fields (`description`, `location`,
 * `operatingOrganisationId`, `primaryIdentifierId`, `secondaryIdentifierIds`)
 * has clear-to-default semantics on create (there is nothing yet to clear),
 * so a literal `null` on any of them is REJECTED with a 400, the same as any
 * other malformed value. This is not equivalent to omitting the field:
 * omission succeeds (the field is simply unset), while an explicit `null`
 * fails the whole bulk request. Clients must omit an optional field to skip
 * it, never send it as `null`.
 */
const facilityItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  location: locationSchema.optional(),
  operatingOrganisationId: idSchema.optional(),
  primaryIdentifierId: idSchema.optional(),
  secondaryIdentifierIds: z.array(idSchema).optional(),
});

/** Request body for POST /facilities: a non-empty array of facility items. */
export const createFacilitiesRequestSchema = nonEmptyArraySchema(facilityItemSchema);

/**
 * Request body for PATCH /facilities/{id}. `description` is `.nullable()`:
 * it is a nullable Prisma scalar column (`String?`), and the repository
 * forwards an explicit `null` straight through as a clear (facility.repository.ts,
 * `if (description !== undefined) data.description = description;`), unlike
 * `location` (a Json column, where Prisma requires `Prisma.JsonNull` rather
 * than a plain `null`, so `location` stays non-nullable here).
 */
export const updateFacilityRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).nullable().optional(),
    location: locationSchema.optional(),
    operatingOrganisationId: idSchema.nullable().optional(),
    primaryIdentifierId: idSchema.nullable().optional(),
    secondaryIdentifierIds: z.array(idSchema).optional(),
  }),
  'At least one updatable field is required: name, description, location, operatingOrganisationId, primaryIdentifierId, secondaryIdentifierIds',
);

/**
 * Query parameters for GET /facilities. `search` and `organisationId` are
 * both left as unconstrained strings (ticket #794's accepted-unchanged AC),
 * but for different reasons:
 * - `search` matches with a "contains" filter, so an empty value matches
 *   every row today; tightening it to non-empty would change that.
 * - `organisationId` matches with an exact-equality filter, so an empty
 *   value matches zero rows today (no facility has an empty FK); it is left
 *   unconstrained per the ticket rather than tightened to idSchema.
 */
export const listFacilitiesQuerySchema = z
  .object({
    search: z.string().optional(),
    organisationId: z.string().optional(),
  })
  .merge(paginationQuerySchema);
