import { z } from 'zod';
import { ServiceType, AdapterType } from '@uncefact/untp-ri-services';
import { booleanQuerySchema, nonBlankString, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * The enums are derived from the constants of record rather than re-listed
 * here, so a new service or adapter type cannot be accepted by the registry
 * while this schema still rejects it (the hand-copied-list drift #857 fixed
 * on the DID response schema).
 *
 * Exported so the OpenAPI `ServiceType` and `AdapterType` components are built
 * from these same schemas: the routes reference those components instead of
 * restating the values, which is what stops the published contract drifting
 * from what the API accepts.
 */
export const serviceTypeSchema = z.nativeEnum(ServiceType);
export const adapterTypeSchema = z.nativeEnum(AdapterType);

/**
 * Adapter configuration, checked here for shape only: an object, not an
 * array and not null. Its contents belong to the adapter, so the route
 * validates the parsed value against that adapter's own `configSchema` from
 * the registry once the adapter is known, and layers `assertPublicUrl` on a
 * `baseUrl` after that. Keep this permissive; narrowing it here would
 * duplicate the adapter contract in a second place and drift from it.
 */
const configSchema = z.record(z.string(), z.unknown(), {
  invalid_type_error: 'must be an object',
  required_error: 'is required',
});

/** Request body for POST /services. */
export const createServiceRequestSchema = z.object({
  serviceType: serviceTypeSchema,
  adapterType: adapterTypeSchema,
  name: nonBlankString,
  // Optional but not nullable on create: there is nothing to clear yet, so an
  // explicit null is a malformed body rather than a no-op. PATCH accepts null
  // to clear a description that exists.
  description: nonBlankString.optional(),
  config: configSchema,
  isPrimary: z.boolean().optional(),
});

/** Request body for PATCH /services/{id}. */
export const updateServiceRequestSchema = requireAtLeastOneField(
  z.object({
    name: nonBlankString.optional(),
    // Nullable to clear: the column is nullable and the handler forwards an
    // explicit null through to the update.
    description: nonBlankString.nullable().optional(),
    // A partial config is merged onto the stored one by the handler, which
    // then revalidates the merged result against the adapter schema.
    config: configSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  'At least one of name, description, config, or isPrimary is required',
);

/**
 * Query parameters for GET /services. Filters first, pagination merged last,
 * so a filter issue is reported before a pagination issue when both are
 * invalid (parseQueryParams renders only the first).
 */
export const listServicesQuerySchema = z
  .object({
    serviceType: serviceTypeSchema.optional(),
    adapterType: adapterTypeSchema.optional(),
  })
  .merge(paginationQuerySchema);

/**
 * Query parameters for DELETE /services/{id}.
 *
 * `force` was previously read as `searchParams.get('force') === 'true'`, so a
 * misspelt value such as `TRUE` or `1` silently meant false and the caller got
 * a 409 they thought they had opted out of. The shared schema accepts exactly
 * "true" or "false" and rejects anything else by naming the parameter.
 */
export const deleteServiceQuerySchema = z.object({
  force: booleanQuerySchema,
});
