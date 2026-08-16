import { z } from 'zod';
import { AccessRole } from '@uncefact/untp-ri-services';
import { bcp47TagSchema, nonBlankString, paginationQuerySchema, requireAtLeastOneField } from './shared';

/** A link accepted by the link publishing route (POST /identifiers/{id}/links). */
export const linkSchema = z.object({
  href: z.string().url(),
  // nonBlankString guards the fields the IDR routes on, where a blank value
  // produces a registration nothing can look up. The remaining free-text
  // fields (title, context, encryptionMethod) are carried through and
  // displayed, so a blank one costs the caller only a blank label.
  rel: nonBlankString,
  type: nonBlankString,
  title: z.string().optional(),
  // Each entry is a language tag published to the IDR and served to resolver
  // clients as the variant's language, so a value that is merely non-empty
  // would be republished as an unusable tag. Well-formedness only, per
  // bcp47TagSchema.
  hreflang: z.array(bcp47TagSchema).optional(),
  context: z.string().optional(),
  default: z.boolean().optional(),
  method: z.enum(['GET', 'POST']).optional(),
  encryptionMethod: z.string().optional(),
  accessRole: z.array(z.nativeEnum(AccessRole)).optional(),
  additionalRels: z.array(nonBlankString).optional(),
  public: z.boolean().optional(),
});

/** Request body for POST /identifiers/{id}/links. */
export const publishLinksRequestSchema = z.object({
  links: z.array(linkSchema).min(1),
  qualifierPath: z.string().optional(),
  description: z.string().optional(),
});

/** Request body for PATCH /identifiers/{id}/links/{linkId}. */
export const updateLinkRequestSchema = requireAtLeastOneField(
  linkSchema.partial(),
  'Request body must include at least one updatable link field',
);

/**
 * Query parameters for GET /identifiers/{id}/links. No domain filters today,
 * so this is pagination alone; switch to `filters.merge(paginationQuerySchema)`
 * (the pattern other resources use) once this resource gains its first filter.
 */
export const listLinksQuerySchema = paginationQuerySchema;
