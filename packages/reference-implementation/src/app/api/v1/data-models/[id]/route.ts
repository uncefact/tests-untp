import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { assertHttpUrl, assertPublicUrl, definedFields, parseRequestBody } from '@/lib/api/validation';
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
 *       description: At least one recognised field is required; unknown keys are ignored.
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
 *                 format: uri
 *                 description: Updated JSON schema URL. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace.
 *               contextUrl:
 *                 type: string
 *                 format: uri
 *                 description: Updated JSON-LD context URL. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace.
 *               websiteUrl:
 *                 type: string
 *                 format: uri
 *                 description: Updated website URL. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace.
 *             anyOf:
 *               - required: [name]
 *               - required: [schemaUrl]
 *               - required: [contextUrl]
 *               - required: [websiteUrl]
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
  const body = await parseRequestBody(req, updateDataModelRequestSchema);

  // The schema checks URL syntax only; see the POST handler for what
  // assertHttpUrl adds on top of it.
  if (body.schemaUrl !== undefined) assertHttpUrl(body.schemaUrl, 'schemaUrl');
  if (body.contextUrl !== undefined) assertHttpUrl(body.contextUrl, 'contextUrl');
  if (body.websiteUrl !== undefined) assertHttpUrl(body.websiteUrl, 'websiteUrl');

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
