import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody } from '@/lib/api/validation';
import { updateRenderTemplateRequestSchema } from '@/lib/api/request-schemas/render-template';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getRenderTemplateById, deleteRenderTemplate } from '@/lib/prisma/repositories';
import { updateRenderTemplate } from '@/lib/render-templates/update-render-template';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import type { ResolvedStorageService } from '@/lib/services/resolve-storage-service';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/render-templates/[id]' });

/**
 * @swagger
 * /render-templates/{id}:
 *   get:
 *     summary: Get a render template by ID
 *     description: Retrieves a specific render template by its database ID. Returns templates owned by the authenticated tenant or system-provisioned templates.
 *     tags:
 *       - Render Templates
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the render template
 *     responses:
 *       200:
 *         description: Render template retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RenderTemplate'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Render template not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  logger.info({ renderTemplateId: id }, 'Looking up render template');
  const renderTemplate = await getRenderTemplateById(id, tenantId);
  if (!renderTemplate) {
    throw new NotFoundError('Render template not found');
  }
  logger.info({ renderTemplateId: id }, 'Render template retrieved');
  return NextResponse.json(renderTemplate);
});

/**
 * @swagger
 * /render-templates/{id}:
 *   patch:
 *     summary: Update a render template
 *     description: >
 *       Updates one or more fields of a tenant-owned render template.
 *       The fields storageUrl, digestMultibase, the legacy hash, and renderMethodType are rejected with a 400 when present: the first three are managed by the server, and the render method type is fixed once the template exists.
 *       When template content is provided, the server re-uploads it to storage and updates storageUrl and digestMultibase automatically.
 *       When setting isDefault to true, any existing default template for the same data model will be unset.
 *     tags:
 *       - Render Templates
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the render template
 *     requestBody:
 *       required: true
 *       description: At least one updatable field is required, and unknown keys are ignored. storageOptions is read only when template is also provided, since it says where the replacement content is uploaded. A body carrying it alone is rejected with a 400, and a body pairing it with another valid updatable field succeeds with the storage option ignored. Sending an empty template is rejected, where it previously returned 200 without changing anything.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: Updated human-readable name for the render template. Must carry more than whitespace
 *               template:
 *                 type: string
 *                 minLength: 1
 *                 description: HTML content to replace the existing template
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this is the default template for its data model
 *               inline:
 *                 type: boolean
 *                 description: Whether to inline the template (RenderTemplate2024 only)
 *               mediaType:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: Media type of the template (RenderTemplate2024 only). Null resets it to the type's default
 *               mediaQuery:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: CSS media query (RenderTemplate2024 only). Null clears it
 *               storageOptions:
 *                 type: object
 *                 properties:
 *                   serviceInstanceId:
 *                     type: string
 *                     minLength: 1
 *                     description: Explicit storage service instance ID to use for the re-upload. Read only when template is also provided
 *             anyOf:
 *               - required: [name]
 *               - required: [template]
 *               - required: [isDefault]
 *               - required: [inline]
 *               - required: [mediaType]
 *               - required: [mediaQuery]
 *     responses:
 *       200:
 *         description: Render template updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RenderTemplate'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: The render template was not found, or storageOptions.serviceInstanceId names a storage service instance that does not exist for this tenant. The response body names which of the two it was
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ renderTemplateId: id }, 'Validating update fields');
  const body = await parseRequestBody(req, updateRenderTemplateRequestSchema);

  // Resolve storage service if template content is being replaced
  let storageService: ResolvedStorageService | undefined;
  if (body.template !== undefined) {
    logger.info('Resolving storage service for template re-upload');
    storageService = await resolveStorageService(tenantId, body.storageOptions?.serviceInstanceId);
  }

  logger.info({ renderTemplateId: id }, 'Updating render template');
  const renderTemplate = await updateRenderTemplate({
    id,
    tenantId,
    name: body.name,
    template: body.template,
    storageService,
    isDefault: body.isDefault,
    inline: body.inline,
    mediaType: body.mediaType,
    mediaQuery: body.mediaQuery,
  });

  logger.info({ renderTemplateId: id }, 'Render template updated');
  return NextResponse.json(renderTemplate);
});

/**
 * @swagger
 * /render-templates/{id}:
 *   delete:
 *     summary: Delete a render template
 *     description: Deletes a tenant-owned render template. Only templates owned by the authenticated tenant can be deleted.
 *     tags:
 *       - Render Templates
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the render template
 *     responses:
 *       204:
 *         description: Render template deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Render template not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ renderTemplateId: id }, 'Deleting render template from database');
  const deleted = await deleteRenderTemplate(id, tenantId);
  logger.info({ renderTemplateId: id }, 'Render template deleted from database');

  // Best-effort storage deletion using resource ID and bucket
  if (deleted.storageExternalId) {
    logger.info(
      { renderTemplateId: id, storageExternalId: deleted.storageExternalId, storageBucket: deleted.storageBucket },
      'Resolving storage service for content deletion',
    );
    try {
      const storageService = await resolveStorageService(tenantId, deleted.storageServiceInstanceId ?? undefined);
      logger.info(
        { renderTemplateId: id, storageExternalId: deleted.storageExternalId, storageBucket: deleted.storageBucket },
        'Deleting template content from storage',
      );
      await storageService.service.delete(deleted.storageExternalId, deleted.storageBucket ?? undefined);
      logger.info(
        { renderTemplateId: id, storageExternalId: deleted.storageExternalId },
        'Template content deleted from storage',
      );
    } catch (e) {
      logger.warn(
        {
          renderTemplateId: id,
          storageExternalId: deleted.storageExternalId,
          storageServiceInstanceId: deleted.storageServiceInstanceId,
          error: e,
        },
        'Failed to delete template content from storage — content may be orphaned',
      );
    }
  } else {
    logger.info({ renderTemplateId: id }, 'No storage content to delete — skipping storage cleanup');
  }

  logger.info({ renderTemplateId: id }, 'Render template deletion complete');
  return new NextResponse(null, { status: 204 });
});
