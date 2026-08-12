import { z } from 'zod';
import { AccessRole } from '@uncefact/untp-ri-services';
import { requireAtLeastOneField } from './shared';

/** A link accepted by the link publishing route (POST /identifiers/{id}/links). */
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
  accessRole: z.array(z.nativeEnum(AccessRole)).optional(),
  additionalRels: z.array(z.string().min(1)).optional(),
  public: z.boolean().optional(),
});

/** Request body for PATCH /identifiers/{id}/links/{linkId}. */
export const updateLinkRequestSchema = requireAtLeastOneField(
  linkSchema.partial(),
  'Request body must include at least one updatable link field',
);
