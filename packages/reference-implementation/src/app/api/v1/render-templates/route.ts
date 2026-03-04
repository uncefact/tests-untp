import { NextResponse } from 'next/server';
import {
  ValidationError,
  isNonEmptyString,
  validateEnum,
  parsePositiveInt,
  parseNonNegativeInt,
} from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listRenderTemplates } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';
import { RenderMethodType } from '@/lib/prisma/generated';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { createRenderTemplate } from '@/lib/render-templates/create-render-template';

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
 *     description: Creates a new render template for the authenticated tenant. The server uploads the template content to storage and records the resulting URL and hash.
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
 *               - renderMethodType
 *               - template
 *             properties:
 *               name:
 *                 type: string
 *                 description: Human-readable name for the render template
 *               dataModelId:
 *                 type: string
 *                 description: ID of the data model this template renders
 *               renderMethodType:
 *                 type: string
 *                 enum: [RenderTemplate2024, WebRenderingTemplate2022]
 *                 description: The W3C render method type
 *               template:
 *                 type: string
 *                 description: HTML content of the render template
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this is the primary template for the data model. Setting to true will unset any existing primary template for the same data model.
 *               inline:
 *                 type: boolean
 *                 description: Whether the template is inline (applicable to RenderTemplate2024)
 *               mediaType:
 *                 type: string
 *                 description: Media type for the render method (applicable to RenderTemplate2024)
 *               mediaQuery:
 *                 type: string
 *                 description: CSS media query for the render method (applicable to RenderTemplate2024)
 *               storageOptions:
 *                 type: object
 *                 properties:
 *                   serviceInstanceId:
 *                     type: string
 *                     description: Explicit storage service instance ID to use
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: Record<string, unknown>;

  logger.info('Parsing request body');
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  // Reject server-managed fields
  if (body.storageUrl !== undefined) throw new ValidationError('storageUrl cannot be set directly');
  if (body.hash !== undefined) throw new ValidationError('hash cannot be set directly');

  // Validate required fields
  if (!isNonEmptyString(body.name)) throw new ValidationError('name is required');
  if (!isNonEmptyString(body.dataModelId)) throw new ValidationError('dataModelId is required');
  if (!isNonEmptyString(body.renderMethodType)) throw new ValidationError('renderMethodType is required');
  if (!isNonEmptyString(body.template)) throw new ValidationError('template is required');

  // Validate optional field types
  if (body.isPrimary !== undefined && typeof body.isPrimary !== 'boolean') {
    throw new ValidationError('isPrimary must be a boolean');
  }
  if (body.inline !== undefined && typeof body.inline !== 'boolean') {
    throw new ValidationError('inline must be a boolean');
  }

  logger.info({ renderMethodType: body.renderMethodType }, 'Validating render method type');
  const renderMethodType = validateEnum(
    body.renderMethodType as string,
    Object.values(RenderMethodType),
    'renderMethodType',
  )!;

  const storageOptions = (body.storageOptions as { serviceInstanceId?: string } | undefined) ?? {};

  logger.info('Resolving storage service');
  const storageService = await resolveStorageService(tenantId, storageOptions.serviceInstanceId);

  logger.info({ dataModelId: body.dataModelId, name: body.name }, 'Creating render template');
  const renderTemplate = await createRenderTemplate({
    tenantId,
    name: body.name as string,
    dataModelId: body.dataModelId as string,
    renderMethodType,
    template: body.template as string,
    storageService,
    isPrimary: body.isPrimary,
    inline: body.inline,
    mediaType: body.mediaType as string | undefined,
    mediaQuery: body.mediaQuery as string | undefined,
  });

  logger.info({ renderTemplateId: renderTemplate.id }, 'Render template created');
  return NextResponse.json(renderTemplate, { status: 201 });
});
