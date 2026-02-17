import { NextResponse } from 'next/server';
import {
  ValidationError,
  validateEnum,
  isNonEmptyString,
  parsePositiveInt,
  parseNonNegativeInt,
} from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listDataModels, createDataModel } from '@/lib/prisma/repositories';
import { CredentialType } from '@/lib/prisma/generated';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/data-models' });

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
 *           enum: [DigitalProductPassport, DigitalConformityCredential, DigitalFacilityRecord, DigitalIdentityAnchor, DigitalTraceabilityEvent]
 *         description: Filter by credential type
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
 *         description: Maximum number of results to return
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
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 dataModels:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DataModel'
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

  const isExtension = parseBooleanParam(url.searchParams.get('isExtension'), 'isExtension');
  const credentialType = validateEnum(
    url.searchParams.get('credentialType') ?? undefined,
    Object.values(CredentialType),
    'credentialType',
  );
  const version = url.searchParams.get('version') ?? undefined;
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, filters: { isExtension, credentialType, version, limit, offset } }, 'Listing data models');
  const dataModels = await listDataModels(tenantId, {
    isExtension,
    credentialType,
    version,
    limit,
    offset,
  });

  logger.info({ tenantId, count: dataModels.length }, 'Data models listed');
  return NextResponse.json({ ok: true, dataModels });
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
 *                 enum: [DigitalProductPassport, DigitalConformityCredential, DigitalFacilityRecord, DigitalIdentityAnchor, DigitalTraceabilityEvent]
 *                 description: The credential type this extension applies to
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
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 dataModel:
 *                   $ref: '#/components/schemas/DataModel'
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

  if (!isNonEmptyString(body.name)) throw new ValidationError('name is required');

  const credentialType = validateEnum(body.credentialType, Object.values(CredentialType), 'credentialType');
  if (!credentialType) throw new ValidationError('credentialType is required');

  if (!isNonEmptyString(body.version)) throw new ValidationError('version is required');
  if (!isNonEmptyString(body.schemaUrl)) throw new ValidationError('schemaUrl is required');
  if (!isNonEmptyString(body.contextUrl)) throw new ValidationError('contextUrl is required');
  if (!isNonEmptyString(body.parentConfigId)) {
    throw new ValidationError('parentConfigId is required');
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
  return NextResponse.json({ ok: true, dataModel }, { status: 201 });
});
