import { NextResponse } from 'next/server';
import { parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import {
  createRenderTemplateRequestSchema,
  listRenderTemplatesQuerySchema,
} from '@/lib/api/request-schemas/render-template';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listRenderTemplates } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';
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
 *         description: Number of render templates to return per page. Defaults to 20 unless the deployment maximum is lower. Values above the deployment maximum are rejected with a 400 naming the maximum.
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
 *         description: Validation error (e.g. a non-integer limit/offset, a negative offset, a limit above the maximum, a repeated query parameter)
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
  logger.info('Parsing query parameters');
  const { dataModelId, limit, offset } = parseQueryParams(new URL(req.url), listRenderTemplatesQuerySchema);

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
 *     description: Creates a new render template for the authenticated tenant. The server uploads the template content to storage and records the resulting URL and digest.
 *     tags:
 *       - Render Templates
 *     requestBody:
 *       required: true
 *       description: Unrecognised keys are ignored. The server-managed fields storageUrl and digestMultibase, and the legacy field hash, are rejected with a 400 when present.
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
 *                 minLength: 1
 *                 description: Human-readable name for the render template. Must carry more than whitespace
 *               dataModelId:
 *                 type: string
 *                 minLength: 1
 *                 description: ID of the data model this template renders
 *               renderMethodType:
 *                 type: string
 *                 enum: [RenderTemplate2024, WebRenderingTemplate2022]
 *                 description: The W3C render method type
 *               template:
 *                 type: string
 *                 minLength: 1
 *                 description: HTML content of the render template
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this is the default template for the data model. Setting to true will unset any existing default template for the same data model.
 *               inline:
 *                 type: boolean
 *                 description: Whether the template is inline (applicable to RenderTemplate2024). Omit to skip; null is rejected with a 400
 *               mediaType:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: Media type for the render method (applicable to RenderTemplate2024). Null is accepted and treated as omitted
 *               mediaQuery:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: CSS media query for the render method (applicable to RenderTemplate2024). Null is accepted and treated as omitted
 *               storageOptions:
 *                 type: object
 *                 properties:
 *                   serviceInstanceId:
 *                     type: string
 *                     minLength: 1
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
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: The data model was not found, or storageOptions.serviceInstanceId names a storage service instance that does not exist for this tenant. The response body names which of the two it was
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
  logger.info('Validating request body');
  const body = await parseRequestBody(req, createRenderTemplateRequestSchema);

  logger.info('Resolving storage service');
  const storageService = await resolveStorageService(tenantId, body.storageOptions?.serviceInstanceId);

  logger.info({ dataModelId: body.dataModelId, name: body.name }, 'Creating render template');
  const renderTemplate = await createRenderTemplate({
    tenantId,
    name: body.name,
    dataModelId: body.dataModelId,
    renderMethodType: body.renderMethodType,
    template: body.template,
    storageService,
    isDefault: body.isDefault,
    inline: body.inline,
    mediaType: body.mediaType,
    mediaQuery: body.mediaQuery,
  });

  logger.info({ renderTemplateId: renderTemplate.id }, 'Render template created');
  return NextResponse.json(renderTemplate, { status: 201 });
});
