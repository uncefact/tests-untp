import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listRenderTemplates, createRenderTemplate } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/render-templates' });

/**
 * @swagger
 * /render-templates:
 *   get:
 *     summary: List render templates
 *     description: Retrieves render templates belonging to the authenticated tenant and system-provisioned templates, with optional filtering by data model
 *     tags:
 *       - Render Templates
 *     parameters:
 *       - in: query
 *         name: dataModelId
 *         schema:
 *           type: string
 *         description: Filter by associated data model ID
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
 *         description: Render templates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RenderTemplate'
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
  const dataModelId = url.searchParams.get('dataModelId') ?? undefined;
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ filters: { dataModelId, limit, offset } }, 'Querying render templates');
  const { data, total } = await listRenderTemplates(tenantId, {
    dataModelId,
    limit,
    offset,
  });

  logger.info({ count: data.length }, 'Render templates listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});

/**
 * @swagger
 * /render-templates:
 *   post:
 *     summary: Create a render template
 *     description: Creates a new render template for the authenticated tenant, associated with an existing data model
 *     tags:
 *       - Render Templates
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - dataModelId
 *               - storageUrl
 *               - hash
 *             properties:
 *               name:
 *                 type: string
 *                 description: Human-readable name for the render template
 *               dataModelId:
 *                 type: string
 *                 description: ID of the data model this template renders
 *               storageUrl:
 *                 type: string
 *                 description: URL where the template file is stored
 *               hash:
 *                 type: string
 *                 description: Content hash of the template file for integrity verification
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this is the primary template for the data model. Setting to true will unset any existing primary template for the same data model.
 *     responses:
 *       201:
 *         description: Render template created successfully
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
    dataModelId?: string;
    storageUrl?: string;
    hash?: string;
    isPrimary?: boolean;
  };

  logger.info('Parsing request body');
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (!isNonEmptyString(body.name)) throw new ValidationError('name is required');
  if (!isNonEmptyString(body.dataModelId)) throw new ValidationError('dataModelId is required');
  if (!isNonEmptyString(body.storageUrl)) throw new ValidationError('storageUrl is required');
  if (!isNonEmptyString(body.hash)) throw new ValidationError('hash is required');

  logger.info({ dataModelId: body.dataModelId, name: body.name }, 'Creating render template');
  const renderTemplate = await createRenderTemplate(tenantId, {
    name: body.name,
    dataModelId: body.dataModelId,
    storageUrl: body.storageUrl,
    hash: body.hash,
    ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary }),
  });

  logger.info({ renderTemplateId: renderTemplate.id }, 'Render template created');
  return NextResponse.json(renderTemplate, { status: 201 });
});
