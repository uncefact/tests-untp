/**
 * Shared API response schemas (Swagger / OpenAPI).
 */

import { z } from 'zod';

/**
 * Standard error response returned by the REST API.
 */
export const errorResponseSchema = z.object({
  error: z.string().describe('Error message'),
  code: z.string().optional().describe('Machine-readable error code (present for service-layer errors)'),
});
