import type { IStorageService } from '@uncefact/untp-ri-services';
import type { ResolvedService } from '@/lib/services/resolve-service';
import { NotFoundError } from '@/lib/api/errors';
import { getRenderTemplateById, updateRenderTemplate as updateRenderTemplateRepo } from '@/lib/prisma/repositories';
import type { RenderTemplateWithRelations } from '@/lib/prisma/repositories/render-template.repository';
import { validateRenderMethodFields } from './validate-render-method-fields';
import type { RenderMethodFields } from './validate-render-method-fields';
import { sanitiseTemplate } from './sanitise-template';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'update-render-template' });

export type UpdateRenderTemplateInput = {
  id: string;
  tenantId: string;
  name?: string;
  template?: string;
  storageService?: ResolvedService<IStorageService>;
  isDefault?: boolean;
} & RenderMethodFields;

export async function updateRenderTemplate(input: UpdateRenderTemplateInput): Promise<RenderTemplateWithRelations> {
  const { id, tenantId, name, template, storageService, isDefault } = input;

  logger.info({ renderTemplateId: id }, 'Looking up existing render template');
  const existing = await getRenderTemplateById(id, tenantId);
  if (!existing) {
    throw new NotFoundError('Render template not found');
  }

  logger.info({ renderMethodType: existing.renderMethodType }, 'Validating render method fields');
  const validatedFields = validateRenderMethodFields(existing.renderMethodType, {
    inline: input.inline,
    mediaType: input.mediaType,
    mediaQuery: input.mediaQuery,
  });

  let storageUpdates: {
    storageUrl?: string;
    digestMultibase?: string;
    storageServiceInstanceId?: string;
    storageExternalId?: string;
    storageBucket?: string;
    storageContentType?: string;
  } = {};

  if (template && storageService) {
    logger.info('Sanitising template content');
    const sanitisedTemplate = sanitiseTemplate(template);

    // All render templates are stored as HTML; update contentType if non-HTML types are supported in future.
    logger.info({ storageInstanceId: storageService.instanceId }, 'Re-uploading template to storage');
    const storageResult = await storageService.service.storeBinary(
      sanitisedTemplate,
      existing.name,
      'text/html',
      false,
    );
    storageUpdates = {
      storageUrl: storageResult.uri,
      digestMultibase: storageResult.digestMultibase,
      storageServiceInstanceId: storageService.instanceId,
      storageExternalId: storageResult.externalId,
      storageBucket: storageResult.bucket,
      storageContentType: storageResult.mimeType,
    };

    // Best-effort delete of old content using resource ID and bucket
    if (existing.storageExternalId) {
      try {
        await storageService.service.delete(existing.storageExternalId, existing.storageBucket ?? undefined);
      } catch (e) {
        logger.warn(
          { storageExternalId: existing.storageExternalId, error: e },
          'Failed to delete old template content from storage',
        );
      }
    }
  }

  logger.info({ renderTemplateId: id }, 'Updating render template record');
  return updateRenderTemplateRepo(id, tenantId, {
    ...(name !== undefined && { name }),
    ...(isDefault !== undefined && { isDefault }),
    ...storageUpdates,
    ...(input.inline !== undefined && { inline: validatedFields.inline }),
    ...(input.mediaType !== undefined && { mediaType: validatedFields.mediaType }),
    ...(input.mediaQuery !== undefined && { mediaQuery: validatedFields.mediaQuery }),
  });
}
