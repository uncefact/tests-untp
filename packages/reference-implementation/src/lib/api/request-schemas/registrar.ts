import { z } from 'zod';
import { idSchema, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * `.url()` here is WHATWG `new URL` parsing, not RFC 3986 validation (it
 * accepts a value RFC 3986 forbids, e.g. `https://example.com/%`), and is a
 * format check only: any scheme, embedded userinfo permitted, no check that
 * the address is public. The POST and PATCH route handlers layer
 * `assertHttpUrl` (scheme + userinfo) and `assertPublicUrl` (SSRF) on top of
 * this after parsing, matching the stored-URL validation credentials/route.ts
 * applies to its own URL fields (ADR-037; data-models/route.ts applies only
 * the env-gated assertPublicUrl today); do not treat this schema check as
 * the whole contract for `url`.
 */
const urlSchema = z.string().url({ message: 'must be a valid URL' });

/** Request body for POST /registrars. */
export const createRegistrarRequestSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  // Required and non-nullable: the underlying DB column is nullable only for
  // registrars created outside this API (e.g. seeded); POST/PATCH through
  // this API deliberately always carry a url.
  url: urlSchema,
  idrServiceInstanceId: idSchema.optional(),
});

/** Request body for PATCH /registrars/{id}. */
export const updateRegistrarRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
    // Optional but not nullable: unlike idrServiceInstanceId, url has no
    // "clear the field" semantic through this API, so an explicit null is
    // rejected rather than accepted as a no-op or a clear.
    url: urlSchema.optional(),
    idrServiceInstanceId: idSchema.nullable().optional(),
  }),
  'At least one field is required',
);

/**
 * Query parameters for GET /registrars. No domain filters today, so this is
 * pagination alone; switch to `filters.merge(paginationQuerySchema)` (the
 * pattern other resources use) once this resource gains its first filter.
 */
export const listRegistrarsQuerySchema = paginationQuerySchema;
