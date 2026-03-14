import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getRenderTemplateById, deleteRenderTemplate } from '@/lib/prisma/repositories';
import { updateRenderTemplate } from '@/lib/render-templates/update-render-template';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import type { ResolvedStorageService } from '@/lib/services/resolve-storage-service';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/render-templates/[id]' });

const REJECTED_FIELDS = ['storageUrl', 'hash', 'renderMethodType'] as const;
const PATCHABLE_FIELDS = ['name', 'template', 'isDefault', 'inline', 'mediaType', 'mediaQuery'] as const;

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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *       The fields storageUrl, hash, and renderMethodType cannot be set directly — they are managed by the server.
 *       When template content is provided, the server re-uploads it to storage and updates storageUrl/hash automatically.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated human-readable name for the render template
 *               template:
 *                 type: string
 *                 description: HTML content to replace the existing template
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this is the default template for its data model
 *               inline:
 *                 type: boolean
 *                 description: Whether to inline the template (RenderTemplate2024 only)
 *               mediaType:
 *                 type: string
 *                 description: Media type of the template (RenderTemplate2024 only)
 *               mediaQuery:
 *                 type: string
 *                 description: CSS media query (RenderTemplate2024 only)
 *               storageOptions:
 *                 type: object
 *                 properties:
 *                   serviceInstanceId:
 *                     type: string
 *                     description: Explicit storage service instance ID to use for upload
 *             minProperties: 1
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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Render template not found or not owned by tenant
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

  let body: Record<string, unknown>;
  logger.info('Parsing request body');
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  // Reject server-managed and immutable fields
  for (const field of REJECTED_FIELDS) {
    if (body[field] !== undefined) {
      throw new ValidationError(`${field} cannot be set directly`);
    }
  }

  logger.info({ renderTemplateId: id }, 'Validating update fields');
  const hasPatchableField = PATCHABLE_FIELDS.some((f) => f in body);
  if (!hasPatchableField) {
    throw new ValidationError(`At least one updatable field must be provided: ${PATCHABLE_FIELDS.join(', ')}`);
  }

  // Resolve storage service if template content is being replaced
  let storageService: ResolvedStorageService | undefined;
  if (isNonEmptyString(body.template)) {
    const storageOptions = (body.storageOptions as { serviceInstanceId?: string } | undefined) ?? {};
    logger.info('Resolving storage service for template re-upload');
    storageService = await resolveStorageService(tenantId, storageOptions.serviceInstanceId);
  }

  // Validate optional field types
  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    throw new ValidationError('isDefault must be a boolean');
  }
  if (body.inline !== undefined && typeof body.inline !== 'boolean') {
    throw new ValidationError('inline must be a boolean');
  }
  if (body.mediaType !== undefined && body.mediaType !== null && !isNonEmptyString(body.mediaType)) {
    throw new ValidationError('mediaType must be a non-empty string');
  }
  if (body.mediaQuery !== undefined && body.mediaQuery !== null && !isNonEmptyString(body.mediaQuery)) {
    throw new ValidationError('mediaQuery must be a non-empty string');
  }

  logger.info({ renderTemplateId: id }, 'Updating render template');
  const renderTemplate = await updateRenderTemplate({
    id,
    tenantId,
    name: body.name as string | undefined,
    template: body.template as string | undefined,
    storageService,
    isDefault: body.isDefault,
    inline: body.inline,
    mediaType: body.mediaType as string | undefined,
    mediaQuery: body.mediaQuery as string | undefined,
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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Render template not found or not owned by tenant
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
