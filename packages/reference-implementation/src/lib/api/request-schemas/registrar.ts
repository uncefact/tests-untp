import { z } from 'zod';
import { idSchema, nonBlankString, paginationQuerySchema, requireAtLeastOneField, urlSchema } from './shared';

/** Request body for POST /registrars. */
export const createRegistrarRequestSchema = z.object({
  name: nonBlankString,
  namespace: nonBlankString,
  // Required and non-nullable: the underlying DB column is nullable only for
  // registrars created outside this API (e.g. seeded); POST/PATCH through
  // this API deliberately always carry a url.
  url: urlSchema,
  idrServiceInstanceId: idSchema.optional(),
});

/** Request body for PATCH /registrars/{id}. */
export const updateRegistrarRequestSchema = requireAtLeastOneField(
  z.object({
    name: nonBlankString.optional(),
    namespace: nonBlankString.optional(),
    // Optional but not nullable: unlike idrServiceInstanceId, url has no
    // "clear the field" semantic through this API, so an explicit null is
    // rejected rather than accepted as a no-op or a clear.
    url: urlSchema.optional(),
    idrServiceInstanceId: idSchema.nullable().optional(),
  }),
  'At least one of name, namespace, url, or idrServiceInstanceId is required',
);

/**
 * Query parameters for GET /registrars. No domain filters today, so this is
 * pagination alone; switch to `filters.merge(paginationQuerySchema)` (the
 * pattern other resources use) once this resource gains its first filter.
 */
export const listRegistrarsQuerySchema = paginationQuerySchema;
