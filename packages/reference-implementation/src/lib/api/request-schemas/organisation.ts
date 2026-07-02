import { z } from 'zod';
import { idSchema, locationSchema, nonEmptyArraySchema, requireAtLeastOneField } from './shared';

/** A single organisation within the POST /organisations array body. */
const organisationCreateItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location: locationSchema.optional(),
  primaryIdentifierId: idSchema.optional(),
  secondaryIdentifierIds: z.array(idSchema).optional(),
});

/** Request body for POST /organisations: an array of organisations to create. */
export const createOrganisationsRequestSchema = nonEmptyArraySchema(organisationCreateItemSchema);

/**
 * Request body for PATCH /organisations/{id}.
 * primaryIdentifierId set to null clears it; secondaryIdentifierIds set to [] clears all.
 */
export const updateOrganisationRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    location: locationSchema.optional(),
    primaryIdentifierId: idSchema.nullable().optional(),
    secondaryIdentifierIds: z.array(idSchema).optional(),
  }),
  'At least one of name, description, location, primaryIdentifierId, or secondaryIdentifierIds is required',
);
