import type { IStorageService } from '@uncefact/untp-ri-services';
import type { ResolvedService } from '@/lib/services/resolve-service';
import { RenderMethodType } from '@/lib/prisma/generated';
import { NotFoundError } from '@/lib/api/errors';
import { getDataModelById, createRenderTemplate as createRenderTemplateRepo } from '@/lib/prisma/repositories';
import type { RenderTemplateWithRelations } from '@/lib/prisma/repositories/render-template.repository';
import { validateRenderMethodFields } from './validate-render-method-fields';
import type { RenderMethodFields } from './validate-render-method-fields';
import { sanitiseTemplate } from './sanitise-template';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'create-render-template' });

export type CreateRenderTemplateInput = {
  tenantId: string;
  name: string;
  dataModelId: string;
  renderMethodType: RenderMethodType;
  template: string;
  storageService: ResolvedService<IStorageService>;
  isDefault?: boolean;
} & RenderMethodFields;

export async function createRenderTemplate(input: CreateRenderTemplateInput): Promise<RenderTemplateWithRelations> {
  const { tenantId, name, dataModelId, renderMethodType, template, storageService, isDefault } = input;

  logger.info({ dataModelId }, 'Verifying data model exists');
  const dataModel = await getDataModelById(dataModelId, tenantId);
  if (!dataModel) {
    throw new NotFoundError('Data model not found');
  }

  logger.info({ renderMethodType }, 'Validating render method fields');
  const validatedFields = validateRenderMethodFields(renderMethodType, {
    inline: input.inline,
    mediaType: input.mediaType,
    mediaQuery: input.mediaQuery,
  });

  logger.info('Sanitising template content');
  const sanitisedTemplate = sanitiseTemplate(template);

  // All render templates are stored as HTML; update contentType if non-HTML types are supported in future.
  logger.info({ storageInstanceId: storageService.instanceId }, 'Uploading template to storage');
  const storageResult = await storageService.service.storeBinary(sanitisedTemplate, name, 'text/html', false);

  logger.info({ uri: storageResult.uri }, 'Creating render template record');
  return createRenderTemplateRepo(tenantId, {
    name,
    dataModelId,
    renderMethodType,
    storageUrl: storageResult.uri,
    hash: storageResult.hash,
    isDefault,
    storageServiceInstanceId: storageService.instanceId,
    storageExternalId: storageResult.externalId,
    storageBucket: storageResult.bucket,
    storageContentType: storageResult.mimeType,
    ...validatedFields,
  });
}
