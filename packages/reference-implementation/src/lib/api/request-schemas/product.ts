import { z } from 'zod';
import { idSchema, nonEmptyArraySchema, requireAtLeastOneField } from './shared';

const PRODUCT_LEVELS = ['MODEL', 'BATCH', 'ITEM'] as const;

const createProductItemSchema = z.object({
  name: z.string().min(1),
  level: z.enum(PRODUCT_LEVELS),
  description: z.string().optional(),
  parentId: idSchema.optional(),
  producedByOrganisationId: idSchema.optional(),
  manufacturingFacilityId: idSchema.optional(),
  primaryIdentifierId: idSchema.optional(),
  secondaryIdentifierIds: z.array(idSchema).optional(),
});

/** Request body for POST /products: one or more products created in a single call. */
export const createProductsRequestSchema = nonEmptyArraySchema(createProductItemSchema);

/**
 * Request body for PATCH /products/{id}. Level is immutable and not accepted here.
 * parentId, producedByOrganisationId, manufacturingFacilityId, and primaryIdentifierId
 * set to null clear the relation; secondaryIdentifierIds has no null-clear form (send an
 * empty array to clear it).
 */
export const updateProductRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    parentId: idSchema.nullable().optional(),
    producedByOrganisationId: idSchema.nullable().optional(),
    manufacturingFacilityId: idSchema.nullable().optional(),
    primaryIdentifierId: idSchema.nullable().optional(),
    secondaryIdentifierIds: z.array(idSchema).optional(),
  }),
  'At least one updatable field must be provided: name, description, parentId, producedByOrganisationId, manufacturingFacilityId, primaryIdentifierId, secondaryIdentifierIds',
);
