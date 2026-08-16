import { z } from 'zod';
import type { ProductLevel } from '@/lib/prisma/generated';
import { idSchema, nonBlankString, nonEmptyArraySchema, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * The product hierarchy levels accepted on the wire, keyed by the generated
 * Prisma `ProductLevel` so the accepted set tracks the column that stores it.
 * The import is type-only, so nothing from the generated client reaches the
 * bundle. That is also why the values are written out and passed to `z.enum`
 * rather than handed to `z.nativeEnum`, which would need the runtime enum
 * object a type-only import deliberately does not bring in.
 *
 * The `Record` is what keeps the list honest: adding a level to the Prisma
 * enum fails to compile here as a missing property, and renaming or removing
 * one fails as an unknown property. A level added to the enum but not to the
 * repository's own input type is caught in turn where the parsed body is
 * handed to `createProducts`.
 */
const PRODUCT_LEVEL_KEYS: Record<ProductLevel, true> = { MODEL: true, BATCH: true, ITEM: true };
const productLevelSchema = z.enum(Object.keys(PRODUCT_LEVEL_KEYS) as [ProductLevel, ...ProductLevel[]]);

/**
 * A set of identifier ids carried on a product, rejecting an in-array
 * duplicate as a well-formedness issue at the boundary. The repository's
 * `validateNoPrimarySecondaryOverlap` already rejects duplicates, so this
 * closes no defect. What it adds is a field-prefixed message and an earlier
 * rejection: on create, ahead of the repository's per-identifier ownership
 * lookups, and on update, ahead of its transaction (that path already checks
 * for duplicates before its own ownership loop). The cross-field and
 * existing-data checks stay in the repository (ADR-036/037).
 */
const secondaryIdentifierIdsSchema = z
  .array(idSchema)
  .refine((val) => new Set(val).size === val.length, { message: 'must not contain duplicate identifiers' });

/**
 * A single item in the POST /products bulk-create request body.
 *
 * No field is nullable. There is nothing to clear on a record that does not
 * exist yet, so create has no null-to-clear contract, matching the decision
 * facilities and organisations already record. This is a change: the previous
 * handler validated only `name` and `level` and cast the rest through, so an
 * explicit `null` on any optional field was stored as null. Clients omit an
 * optional field to skip it rather than sending `null`.
 *
 * `level` is accepted here and stripped on update, because a product's place
 * in the hierarchy is fixed at creation.
 */
const productItemSchema = z.object({
  name: nonBlankString,
  level: productLevelSchema,
  description: nonBlankString.optional(),
  parentId: idSchema.optional(),
  producedByOrganisationId: idSchema.optional(),
  manufacturingFacilityId: idSchema.optional(),
  primaryIdentifierId: idSchema.optional(),
  secondaryIdentifierIds: secondaryIdentifierIdsSchema.optional(),
});

/** Request body for POST /products: a non-empty array of product items. */
export const createProductsRequestSchema = nonEmptyArraySchema(productItemSchema);

/**
 * Request body for PATCH /products/{id}.
 *
 * The four relation ids and `description` are `.nullable()` because each is a
 * nullable column whose explicit `null` the repository forwards as a clear.
 * Clearing `parentId` on a BATCH product still fails the hierarchy rule in
 * the repository, which is a domain check rather than a shape one.
 *
 * `secondaryIdentifierIds` is a replacement command rather than a nullable
 * column, so it is not nullable and carries no `.min()`: an empty array is
 * the established way to clear every secondary identifier, and omitting the
 * field leaves them untouched.
 *
 * `level` is absent, so a client that sends it back has it stripped rather
 * than rejected (ADR-037 decision point 4). A body whose only keys are
 * unrecognised, `level` among them, fails the at-least-one-field check.
 */
export const updateProductRequestSchema = requireAtLeastOneField(
  z.object({
    name: nonBlankString.optional(),
    description: nonBlankString.nullable().optional(),
    parentId: idSchema.nullable().optional(),
    producedByOrganisationId: idSchema.nullable().optional(),
    manufacturingFacilityId: idSchema.nullable().optional(),
    primaryIdentifierId: idSchema.nullable().optional(),
    secondaryIdentifierIds: secondaryIdentifierIdsSchema.optional(),
  }),
  'At least one updatable field is required: name, description, parentId, producedByOrganisationId, manufacturingFacilityId, primaryIdentifierId, secondaryIdentifierIds',
);

/**
 * Query parameters for GET /products. The filters merge ahead of pagination
 * so a malformed filter is reported before a pagination issue, matching the
 * sibling resources and what this route reported before the migration.
 *
 * `search`, `parentId`, `organisationId` and `facilityId` stay unconstrained
 * strings rather than `idSchema` (#795 keeps them accepted unchanged). An
 * empty value is meaningful today: `search` is skipped by a falsy check and
 * returns the unfiltered list, while the three id filters match by exact
 * equality and return an empty page. Tightening them would turn both into a
 * 400.
 */
export const listProductsQuerySchema = z
  .object({
    search: z.string().optional(),
    level: productLevelSchema.optional(),
    parentId: z.string().optional(),
    organisationId: z.string().optional(),
    facilityId: z.string().optional(),
  })
  .merge(paginationQuerySchema);
