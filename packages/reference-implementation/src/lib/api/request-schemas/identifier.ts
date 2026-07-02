import { z } from 'zod';

/** Request body for POST /identifiers. */
export const createIdentifierRequestSchema = z.object({
  schemeId: z.string().min(1),
  value: z.string().min(1),
});

/** Request body for PATCH /identifiers/{id}. */
export const updateIdentifierRequestSchema = z.object({
  value: z.string().min(1),
});
