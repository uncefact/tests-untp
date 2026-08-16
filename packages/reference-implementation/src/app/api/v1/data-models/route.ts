import { apiLogger } from '@/lib/api/logger';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { assertHttpUrl, assertPublicUrl, parseQueryParams, parseRequestBody } from '@/lib/api/validation';
import { createDataModelRequestSchema, listDataModelsQuerySchema } from '@/lib/api/request-schemas/data-model';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDataModel, listDataModels } from '@/lib/prisma/repositories';

import { NextResponse } from 'next/server';

const logger = apiLogger.child({ route: '/api/v1/data-models' });

/**
 * @swagger
 * /data-models:
 *   get:
 *     summary: List data models
 *     description: Retrieves data models visible to the authenticated tenant, including system-provisioned and tenant-owned configs
 *     tags:
 *       - Data Models
 *     parameters:
 *       - in: query
 *         name: isExtension
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: Filter by extension status
 *       - in: query
 *         name: credentialType
 *         schema:
 *           type: string
 *         description: Filter by credential type (any string, e.g. DigitalProductPassport, DigitalLivestockPassport)
 *       - in: query
 *         name: version
 *         schema:
 *           type: string
 *         description: Filter by version string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of entries to return per page. Defaults to 20, or the configured maximum when it is lower. A larger value is rejected with a 400 naming the maximum.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of results to skip for pagination
 *     responses:
 *       200:
 *         description: Data models retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DataModel'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error (e.g. a non-integer limit/offset, a negative offset, a limit above the maximum, a non-boolean isExtension, a repeated query parameter)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  logger.info('Parsing query filters');
  const { isExtension, credentialType, version, limit, offset } = parseQueryParams(
    new URL(req.url),
    listDataModelsQuerySchema,
  );

  logger.info(
    { filters: { isExtension, credentialType, version, limit, offset } },
    'Querying data models from database',
  );
  const { data, total } = await listDataModels(tenantId, {
    isExtension,
    credentialType,
    version,
    limit,
    offset,
  });

  // Strip parentConfig from the response — it's used internally but not exposed to clients
  const responseData = data.map(({ parentConfig: _, ...rest }) => rest);

  logger.info({ count: responseData.length, total }, 'Data models listed');
  return NextResponse.json(buildPaginatedResponse(responseData, total, limit, offset));
});

/**
 * @swagger
 * /data-models:
 *   post:
 *     summary: Create a data model extension
 *     description: Creates a new data model extension for the authenticated tenant
 *     tags:
 *       - Data Models
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - credentialType
 *               - version
 *               - schemaUrl
 *               - contextUrl
 *               - parentConfigId
 *             properties:
 *               name:
 *                 type: string
 *                 description: Human-readable name for the data model extension
 *               credentialType:
 *                 type: string
 *                 description: The credential type this extension applies to (any string, e.g. DigitalProductPassport, DigitalLivestockPassport)
 *               version:
 *                 type: string
 *                 description: Specification version (e.g., "0.6.0")
 *               schemaUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to the JSON schema for this extension. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace.
 *               contextUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to the JSON-LD context for this extension. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace.
 *               parentConfigId:
 *                 type: string
 *                 description: ID of the parent core data model
 *               websiteUrl:
 *                 type: string
 *                 format: uri
 *                 description: Optional website URL for the extension specification. Rejected with a 400 if it is not a valid, public http(s) URL, or if it carries leading or trailing whitespace.
 *     responses:
 *       201:
 *         description: Data model extension created successfully
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
 *         description: Parent data model configuration not found
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  logger.info('Parsing request body');
  const body = await parseRequestBody(req, createDataModelRequestSchema);

  // The schema checks URL syntax only. assertHttpUrl additionally requires an
  // absolute http(s) scheme and rejects embedded userinfo, as the registrars
  // route does for its own stored URL, so none of the three can be stored as
  // a `javascript:` value or carry a credential.
  //
  // All three are stored as the caller submitted them rather than as
  // assertHttpUrl's canonical `.href`, so a caller reads back the URL they
  // sent. Of the three, only schemaUrl is read back by this system:
  // resolveDataModel collects it and validateAgainstSchemas fetches it during
  // credential validation. Storing a value that a later parser may read
  // differently from the one that checked it therefore matters for schemaUrl;
  // #936 tracks closing that by rejecting the ambiguous input rather than by
  // rewriting it, and is open. contextUrl and websiteUrl are stored and served
  // back to API consumers without this system fetching them.
  assertHttpUrl(body.schemaUrl, 'schemaUrl');
  assertHttpUrl(body.contextUrl, 'contextUrl');
  if (body.websiteUrl !== undefined) {
    assertHttpUrl(body.websiteUrl, 'websiteUrl');
  }

  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    logger.info('Validating URLs are not internal');
    await assertPublicUrl(body.schemaUrl, 'schemaUrl');
    await assertPublicUrl(body.contextUrl, 'contextUrl');
    if (body.websiteUrl) {
      await assertPublicUrl(body.websiteUrl, 'websiteUrl');
    }
  }

  logger.info({ credentialType: body.credentialType, name: body.name }, 'Creating data model extension');
  const dataModel = await createDataModel(tenantId, {
    name: body.name,
    credentialType: body.credentialType,
    version: body.version,
    schemaUrl: body.schemaUrl,
    contextUrl: body.contextUrl,
    parentConfigId: body.parentConfigId,
    isExtension: true,
    ...(body.websiteUrl !== undefined && { websiteUrl: body.websiteUrl }),
  });

  logger.info({ dataModelId: dataModel.id }, 'Data model extension created');
  return NextResponse.json(dataModel, { status: 201 });
});
