import { z } from 'zod';
import {
  booleanQuerySchema,
  idSchema,
  nonBlankString,
  paginationQuerySchema,
  requireAtLeastOneField,
  urlSchema,
} from './shared';

/**
 * Request body for POST /data-models.
 *
 * `isExtension` is not accepted: this route creates extensions only and sets
 * the column itself, so a caller-supplied value would either be ignored or
 * let a caller mint a record that claims to be a core data model.
 */
export const createDataModelRequestSchema = z.object({
  name: nonBlankString,
  credentialType: nonBlankString,
  version: nonBlankString,
  schemaUrl: urlSchema,
  contextUrl: urlSchema,
  parentConfigId: idSchema,
  websiteUrl: urlSchema.optional(),
});

/**
 * Request body for PATCH /data-models/{id}. The updatable set is narrower than
 * the creatable one: `credentialType`, `version` and `parentConfigId` are
 * fixed at creation, so they are absent here rather than optional.
 * `parentConfigId` is the pointer to the core model an extension extends; the
 * other two describe the extension itself and are not required to match the
 * parent's.
 */
export const updateDataModelRequestSchema = requireAtLeastOneField(
  z.object({
    name: nonBlankString.optional(),
    schemaUrl: urlSchema.optional(),
    contextUrl: urlSchema.optional(),
    websiteUrl: urlSchema.optional(),
  }),
  'At least one of name, schemaUrl, contextUrl, or websiteUrl is required',
);

/**
 * Query parameters for GET /data-models.
 *
 * `credentialType` and `version` are free-text filters the repository matches
 * on, and #797 leaves what they accept unchanged. Each keeps the handling it
 * had before this schema existed, and the two differ: a blank or
 * whitespace-only `credentialType` drops the filter, while `version` reaches
 * the repository exactly as sent. Aligning them would change what a caller
 * relying on either gets back, which is outside this migration's scope.
 *
 * Pagination merges last so a filter issue is reported ahead of a pagination
 * issue when both are invalid.
 */
export const listDataModelsQuerySchema = z
  .object({
    isExtension: booleanQuerySchema,
    credentialType: z
      .string()
      .optional()
      .transform((value) => (value !== undefined && value.trim() !== '' ? value : undefined)),
    version: z.string().optional(),
  })
  .merge(paginationQuerySchema);
