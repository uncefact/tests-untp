import { z } from 'zod';

/** A link as accepted by the IDR publish route. */
export const linkSchema = z.object({
  href: z.string().url(),
  rel: z.string().min(1),
  type: z.string().min(1),
  title: z.string().optional(),
  hreflang: z.array(z.string().min(1)).optional(),
  context: z.string().optional(),
  default: z.boolean().optional(),
  method: z.enum(['GET', 'POST']).optional(),
  encryptionMethod: z.string().optional(),
  accessRole: z.array(z.string()).optional(),
  additionalRels: z.array(z.string().min(1)).optional(),
  public: z.boolean().optional(),
});

/** Request body for POST /identifiers/{id}/links. */
export const publishLinksRequestSchema = z.object({
  links: z.array(linkSchema).min(1),
  qualifierPath: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Request body for PATCH /identifiers/{id}/links/{linkId}.
 * A partial link; the upstream IDR applies the provided fields.
 */
export const updateLinkRequestSchema = linkSchema.partial();
