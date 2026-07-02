import { z } from 'zod';
import { idSchema, requireAtLeastOneField } from './shared';

/** Request body for POST /data-models. isExtension is always true for tenant-created models and is not client-settable. */
export const createDataModelRequestSchema = z.object({
  name: z.string().min(1),
  credentialType: z.string().min(1),
  version: z.string().min(1),
  schemaUrl: z.string().min(1),
  contextUrl: z.string().min(1),
  parentConfigId: idSchema,
  websiteUrl: z.string().min(1).optional(),
});

/** Request body for PATCH /data-models/{id}. */
export const updateDataModelRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    schemaUrl: z.string().min(1).optional(),
    contextUrl: z.string().min(1).optional(),
    websiteUrl: z.string().min(1).optional(),
  }),
  'At least one updatable field must be provided: name, schemaUrl, contextUrl, websiteUrl',
);
