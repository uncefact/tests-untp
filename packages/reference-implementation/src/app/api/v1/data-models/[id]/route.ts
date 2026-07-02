import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { assertPublicUrl, parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateDataModelRequestSchema } from '@/lib/api/request-schemas/data-model';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDataModelById, updateDataModel, deleteDataModel } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/data-models/[id]' });

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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     description: Updates one or more fields of a tenant-owned data model extension. Only extensions (isExtension=true) owned by the tenant can be updated.
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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Data model not found or not a tenant-owned extension
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

  logger.info({ dataModelId: id }, 'Parsing and validating request body');
  const body = await parseRequestBody(req, updateDataModelRequestSchema);

  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    logger.info({ dataModelId: id }, 'Validating URLs are not internal');
    if (body.schemaUrl !== undefined) await assertPublicUrl(body.schemaUrl, 'schemaUrl');
    if (body.contextUrl !== undefined) await assertPublicUrl(body.contextUrl, 'contextUrl');
    if (body.websiteUrl !== undefined) await assertPublicUrl(body.websiteUrl, 'websiteUrl');
  }

  logger.info({ dataModelId: id }, 'Updating data model');
  const dataModel = await updateDataModel(id, tenantId, definedFields(body));

  logger.info({ dataModelId: id }, 'Data model updated');
  return NextResponse.json(dataModel);
});

/**
 * @swagger
 * /data-models/{id}:
 *   delete:
 *     summary: Delete a data model extension
 *     description: Deletes a tenant-owned data model extension. Only extensions (isExtension=true) owned by the tenant can be deleted.
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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Data model not found or not a tenant-owned extension
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
