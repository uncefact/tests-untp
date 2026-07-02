import { z } from 'zod';
import { RenderMethodType } from '@/lib/prisma/generated';
import { idSchema } from './shared';

const storageOptionsSchema = z.object({
  serviceInstanceId: z.string().min(1).optional(),
});

const storageUrlRejected = z.undefined({ invalid_type_error: 'cannot be set directly' });
const digestMultibaseRejected = z.undefined({ invalid_type_error: 'cannot be set directly' });
const hashRejected = z.undefined({ invalid_type_error: 'is no longer accepted; use digestMultibase' });

/** Request body for POST /render-templates. storageUrl, digestMultibase, and the legacy hash field are server-managed and rejected if present. */
export const createRenderTemplateRequestSchema = z.object({
  name: z.string().min(1),
  dataModelId: idSchema,
  renderMethodType: z.nativeEnum(RenderMethodType),
  template: z.string().min(1),
  isDefault: z.boolean().optional(),
  inline: z.boolean().optional(),
  mediaType: z.string().min(1).nullable().optional(),
  mediaQuery: z.string().min(1).nullable().optional(),
  storageOptions: storageOptionsSchema.optional(),
  storageUrl: storageUrlRejected,
  digestMultibase: digestMultibaseRejected,
  hash: hashRejected,
});

/**
 * Request body for PATCH /render-templates/{id}. storageUrl, digestMultibase, hash, and
 * renderMethodType are server-managed/immutable and rejected if present. A provided
 * template must be a non-empty string; the server re-uploads it to storage.
 */
export const updateRenderTemplateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    template: z.string().min(1).optional(),
    isDefault: z.boolean().optional(),
    inline: z.boolean().optional(),
    mediaType: z.string().min(1).nullable().optional(),
    mediaQuery: z.string().min(1).nullable().optional(),
    storageOptions: storageOptionsSchema.optional(),
    storageUrl: storageUrlRejected,
    digestMultibase: digestMultibaseRejected,
    hash: hashRejected,
    renderMethodType: z.undefined({ invalid_type_error: 'cannot be changed after creation' }),
  })
  // Bespoke rather than requireAtLeastOneField: storageOptions alone is not an
  // update (it only qualifies a template re-upload), so it does not count.
  .refine(
    (body) =>
      [body.name, body.template, body.isDefault, body.inline, body.mediaType, body.mediaQuery].some(
        (value) => value !== undefined,
      ),
    {
      message:
        'At least one updatable field must be provided: name, template, isDefault, inline, mediaType, mediaQuery',
    },
  );
