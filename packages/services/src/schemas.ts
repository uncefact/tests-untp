/**
 * Shared API response schemas (Swagger / OpenAPI).
 */

import { z } from 'zod';

/**
 * Standard error response returned by the REST API.
 */
export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string().describe('Error message'),
});
