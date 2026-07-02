import { z } from 'zod';
import { idSchema, locationSchema, nonEmptyArraySchema, requireAtLeastOneField } from './shared';

/** A single facility within the POST /facilities array body. */
const facilityCreateItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location: locationSchema.optional(),
  operatingOrganisationId: idSchema.optional(),
  primaryIdentifierId: idSchema.optional(),
  secondaryIdentifierIds: z.array(idSchema).optional(),
});

/** Request body for POST /facilities: an array of facilities to create. */
export const createFacilitiesRequestSchema = nonEmptyArraySchema(facilityCreateItemSchema);

/**
 * Request body for PATCH /facilities/{id}.
 * operatingOrganisationId and primaryIdentifierId set to null clear them;
 * secondaryIdentifierIds set to [] clears all secondary identifiers.
 */
export const updateFacilityRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    location: locationSchema.optional(),
    operatingOrganisationId: idSchema.nullable().optional(),
    primaryIdentifierId: idSchema.nullable().optional(),
    secondaryIdentifierIds: z.array(idSchema).optional(),
  }),
  'At least one of name, description, location, operatingOrganisationId, primaryIdentifierId, or secondaryIdentifierIds is required',
);
