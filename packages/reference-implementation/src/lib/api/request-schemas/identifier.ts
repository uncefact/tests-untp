import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './shared';

/** Request body for POST /identifiers. */
export const createIdentifierRequestSchema = z.object({
  schemeId: idSchema,
  value: z.string().min(1),
});

/** Request body for PATCH /identifiers/{id}. */
export const updateIdentifierRequestSchema = z.object({
  value: z.string().min(1),
});

/**
 * Query parameters for GET /identifiers. Merges the `schemeId` filter ahead
 * of pagination so a malformed filter is reported before a pagination issue
 * among the zod schema's own issues (ADR-037). A repeated query key is
 * rejected by parseQueryParams before schema parsing runs at all, so that
 * check takes precedence over both.
 */
export const listIdentifiersQuerySchema = z
  .object({
    schemeId: idSchema.optional(),
  })
  .merge(paginationQuerySchema);
