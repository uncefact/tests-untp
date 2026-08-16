import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { assertPublicUrl, ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDataModelById, updateDataModel, deleteDataModel } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/data-models/[id]' });

const UPDATABLE_FIELDS = ['name', 'schemaUrl', 'contextUrl', 'websiteUrl'] as const;

/**
 * @swagger
 * /data-models/{id}:
 *   get:
 *     summary: Get a data model by ID
 *     description: Retrieves a specific data model by its database ID. Returns system-provisioned or tenant-owned models.
 *     tags:
 *       - Data Models
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the data model
 *     responses:
 *       200:
 *         description: Data model retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataModel'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Data model not found
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
  logger.info({ dataModelId: id }, 'Looking up data model');
  const dataModel = await getDataModelById(id, tenantId);
  if (!dataModel) {
    throw new NotFoundError('Data model not found');
  }
  logger.info({ dataModelId: id }, 'Data model retrieved');
  return NextResponse.json(dataModel);
});

/**
 * @swagger
 * /data-models/{id}:
 *   patch:
 *     summary: Update a data model extension
 *     description: Updates one or more fields of a tenant-owned data model extension. Only tenant-created extensions can be updated.
 *     tags:
 *       - Data Models
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the data model
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated name for the data model extension
 *               schemaUrl:
 *                 type: string
 *                 description: Updated JSON schema URL
 *               contextUrl:
 *                 type: string
 *                 description: Updated JSON-LD context URL
 *               websiteUrl:
 *                 type: string
 *                 description: Updated website URL
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Data model updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataModel'
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
 *         description: Data model not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: A data model with this name already exists for the credential type and version
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

  logger.info({ dataModelId: id }, 'Parsing request body');
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ dataModelId: id }, 'Validating input parameters');
  const hasUpdatableField = UPDATABLE_FIELDS.some((field) => field in body);
  if (!hasUpdatableField) {
    throw new ValidationError(`At least one updatable field must be provided: ${UPDATABLE_FIELDS.join(', ')}`);
  }

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }
  if (body.schemaUrl !== undefined && !isNonEmptyString(body.schemaUrl)) {
    throw new ValidationError('schemaUrl must be a non-empty string');
  }
  if (body.contextUrl !== undefined && !isNonEmptyString(body.contextUrl)) {
    throw new ValidationError('contextUrl must be a non-empty string');
  }
  if (body.websiteUrl !== undefined && !isNonEmptyString(body.websiteUrl)) {
    throw new ValidationError('websiteUrl must be a non-empty string');
  }

  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    logger.info({ dataModelId: id }, 'Validating URLs are not internal');
    if (isNonEmptyString(body.schemaUrl)) await assertPublicUrl(body.schemaUrl, 'schemaUrl');
    if (isNonEmptyString(body.contextUrl)) await assertPublicUrl(body.contextUrl, 'contextUrl');
    if (isNonEmptyString(body.websiteUrl)) await assertPublicUrl(body.websiteUrl, 'websiteUrl');
  }

  logger.info({ dataModelId: id }, 'Updating data model');
  const dataModel = await updateDataModel(id, tenantId, {
    ...(body.name !== undefined && { name: body.name as string }),
    ...(body.schemaUrl !== undefined && { schemaUrl: body.schemaUrl as string }),
    ...(body.contextUrl !== undefined && { contextUrl: body.contextUrl as string }),
    ...(body.websiteUrl !== undefined && { websiteUrl: body.websiteUrl as string }),
  });

  logger.info({ dataModelId: id }, 'Data model updated');
  return NextResponse.json(dataModel);
});

/**
 * @swagger
 * /data-models/{id}:
 *   delete:
 *     summary: Delete a data model extension
 *     description: Deletes a tenant-owned data model extension. Only tenant-created extensions can be deleted.
 *     tags:
 *       - Data Models
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the data model
 *     responses:
 *       204:
 *         description: Data model deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Data model not found
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

  logger.info({ dataModelId: id }, 'Deleting data model');
  await deleteDataModel(id, tenantId);

  logger.info({ dataModelId: id }, 'Data model deleted');
  return new NextResponse(null, { status: 204 });
});
