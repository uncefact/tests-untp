import { NextResponse } from 'next/server';
import { parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { createIdentifierRequestSchema, listIdentifiersQuerySchema } from '@/lib/api/request-schemas/identifier';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createIdentifier, listIdentifiers } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, clampLimit } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/identifiers' });

/**
 * @swagger
 * /identifiers:
 *   post:
 *     summary: Create a new identifier
 *     description: Creates a new identifier after validating the value against the scheme's validation pattern
 *     tags:
 *       - Identifiers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - schemeId
 *               - value
 *             properties:
 *               schemeId:
 *                 type: string
 *                 minLength: 1
 *                 description: ID of the identifier scheme
 *               value:
 *                 type: string
 *                 minLength: 1
 *                 description: The identifier value (validated against scheme pattern)
 *     responses:
 *       201:
 *         description: Identifier created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Identifier'
 *       400:
 *         description: Validation error (e.g. value does not match scheme pattern)
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
 *         description: Scheme not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An identifier with this value already exists for the scheme
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
  const body = await parseRequestBody(req, createIdentifierRequestSchema);

  logger.info({ schemeId: body.schemeId }, 'Creating identifier');
  const identifier = await createIdentifier({
    tenantId,
    schemeId: body.schemeId,
    value: body.value,
  });

  logger.info({ identifierId: identifier.id, schemeId: body.schemeId }, 'Identifier created');
  return NextResponse.json(identifier, { status: 201 });
});

/**
 * @swagger
 * /identifiers:
 *   get:
 *     summary: List identifiers
 *     description: Retrieves a list of identifiers for the authenticated tenant with optional filtering
 *     tags:
 *       - Identifiers
 *     parameters:
 *       - in: query
 *         name: schemeId
 *         schema:
 *           type: string
 *           minLength: 1
 *         description: Filter by identifier scheme ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of identifiers to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of identifiers to skip for pagination
 *     responses:
 *       200:
 *         description: List of identifiers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Identifier'
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
  logger.info('Parsing query parameters');
  const query = parseQueryParams(new URL(req.url), listIdentifiersQuerySchema);
  const { schemeId } = query;
  const limit = clampLimit(query.limit);
  const offset = query.offset;

  logger.info({ schemeId, limit, offset }, 'Listing identifiers');
  const { data, total } = await listIdentifiers(tenantId, { schemeId, limit, offset });

  logger.info({ count: data.length }, 'Identifiers listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
