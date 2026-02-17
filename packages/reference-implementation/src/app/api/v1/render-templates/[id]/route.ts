import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getRenderTemplateById, updateRenderTemplate, deleteRenderTemplate } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/render-templates/[id]' });

const UPDATABLE_FIELDS = ['name', 'storageUrl', 'hash', 'isPrimary'] as const;

/**
 * @swagger
 * /render-templates/{id}:
 *   get:
 *     summary: Get a render template by ID
 *     description: Retrieves a specific render template by its database ID. Only templates owned by the authenticated tenant are returned.
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
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 renderTemplate:
 *                   $ref: '#/components/schemas/RenderTemplate'
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
  logger.info({ tenantId, renderTemplateId: id }, 'Looking up render template');
  const renderTemplate = await getRenderTemplateById(id, tenantId);
  if (!renderTemplate) {
    throw new NotFoundError('Render template not found');
  }
  return NextResponse.json({ ok: true, renderTemplate });
});

/**
 * @swagger
 * /render-templates/{id}:
 *   patch:
 *     summary: Update a render template
 *     description: Updates one or more fields of a tenant-owned render template. When setting isPrimary to true, any existing primary template for the same data model will be unset.
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
 *               storageUrl:
 *                 type: string
 *                 description: Updated URL where the template file is stored
 *               hash:
 *                 type: string
 *                 description: Updated content hash of the template file
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this is the primary template for its data model
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Render template updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 renderTemplate:
 *                   $ref: '#/components/schemas/RenderTemplate'
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

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const hasUpdatableField = UPDATABLE_FIELDS.some((field) => field in body);
  if (!hasUpdatableField) {
    throw new ValidationError(`At least one updatable field must be provided: ${UPDATABLE_FIELDS.join(', ')}`);
  }

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }

  logger.info({ tenantId, renderTemplateId: id }, 'Updating render template');
  const renderTemplate = await updateRenderTemplate(id, tenantId, {
    ...(body.name !== undefined && { name: body.name as string }),
    ...(body.storageUrl !== undefined && { storageUrl: body.storageUrl as string }),
    ...(body.hash !== undefined && { hash: body.hash as string }),
    ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary as boolean }),
  });

  logger.info({ tenantId, renderTemplateId: id }, 'Render template updated');
  return NextResponse.json({ ok: true, renderTemplate });
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
 *       200:
 *         description: Render template deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
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

  logger.info({ tenantId, renderTemplateId: id }, 'Deleting render template');
  await deleteRenderTemplate(id, tenantId);

  logger.info({ tenantId, renderTemplateId: id }, 'Render template deleted');
  return NextResponse.json({ ok: true });
});
