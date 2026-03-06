import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listDataModels, createDataModel } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/data-models' });

const MAX_LIMIT = 100;

/**
 * Parse a boolean string query parameter ("true" or "false").
 * Returns undefined if the raw value is null/undefined.
 * Throws ValidationError if the value is present but not "true" or "false".
 */
function parseBooleanParam(raw: string | null | undefined, paramName: string): boolean | undefined {
  if (raw == null) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ValidationError(`${paramName} must be "true" or "false"`);
}

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

  logger.info({ tenantId }, 'Parsing query filters');
  const isExtension = parseBooleanParam(url.searchParams.get('isExtension'), 'isExtension');
  const rawCredentialType = url.searchParams.get('credentialType');
  const credentialType = rawCredentialType && rawCredentialType.trim() !== '' ? rawCredentialType : undefined;
  const version = url.searchParams.get('version') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info(
    { tenantId, filters: { isExtension, credentialType, version, limit, offset } },
    'Querying data models from database',
  );
  const { data, total } = await listDataModels(tenantId, {
    isExtension,
    credentialType,
    version,
    limit,
    offset,
  });

  logger.info({ tenantId, count: data.length, total }, 'Data models listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
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
 *         description: Parent config not found
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
  logger.info({ tenantId }, 'Parsing request body');
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

  logger.info({ tenantId }, 'Validating input parameters');
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

  logger.info({ tenantId, credentialType, name: body.name }, 'Creating data model extension');
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

  logger.info({ tenantId, dataModelId: dataModel.id }, 'Data model extension created');
  return NextResponse.json(dataModel, { status: 201 });
});
