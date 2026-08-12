import { apiLogger } from '@/lib/api/logger';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import {
  assertPublicUrl,
  isNonEmptyString,
  parseBooleanString,
  parseNonNegativeInt,
  parsePositiveInt,
  ValidationError,
} from '@/lib/api/validation';
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
 *           maximum: 100
 *         description: Maximum number of results to return (capped at 100)
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);

  logger.info('Parsing query filters');
  const isExtension = parseBooleanString(url.searchParams.get('isExtension'), 'isExtension');
  const rawCredentialType = url.searchParams.get('credentialType');
  const credentialType = rawCredentialType && rawCredentialType.trim() !== '' ? rawCredentialType : undefined;
  const version = url.searchParams.get('version') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

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
 *                 description: URL to the JSON schema for this extension
 *               contextUrl:
 *                 type: string
 *                 description: URL to the JSON-LD context for this extension
 *               parentConfigId:
 *                 type: string
 *                 description: ID of the parent core data model
 *               websiteUrl:
 *                 type: string
 *                 description: Optional website URL for the extension specification
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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
  let body: {
    name?: string;
    credentialType?: string;
    version?: string;
    schemaUrl?: string;
    contextUrl?: string;
    parentConfigId?: string;
    websiteUrl?: string;
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info('Validating input parameters');
  if (!isNonEmptyString(body.name)) throw new ValidationError('name is required');

  if (!isNonEmptyString(body.credentialType)) throw new ValidationError('credentialType is required');
  const credentialType = body.credentialType;

  if (!isNonEmptyString(body.version)) throw new ValidationError('version is required');
  if (!isNonEmptyString(body.schemaUrl)) throw new ValidationError('schemaUrl is required');
  if (!isNonEmptyString(body.contextUrl)) throw new ValidationError('contextUrl is required');
  if (!isNonEmptyString(body.parentConfigId)) {
    throw new ValidationError('parentConfigId is required');
  }
  if (body.websiteUrl !== undefined && !isNonEmptyString(body.websiteUrl)) {
    throw new ValidationError('websiteUrl must be a non-empty string');
  }

  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    logger.info('Validating URLs are not internal');
    await assertPublicUrl(body.schemaUrl, 'schemaUrl');
    await assertPublicUrl(body.contextUrl, 'contextUrl');
    if (body.websiteUrl) {
      await assertPublicUrl(body.websiteUrl, 'websiteUrl');
    }
  }

  logger.info({ credentialType, name: body.name }, 'Creating data model extension');
  const dataModel = await createDataModel(tenantId, {
    name: body.name,
    credentialType,
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
