import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createOrganisations, listOrganisations } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/organisations' });

/**
 * @swagger
 * /organisations:
 *   post:
 *     summary: Create organisations
 *     description: Creates one or more organisations from an array of input objects
 *     tags:
 *       - Organisations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required:
 *                 - name
 *               properties:
 *                 name:
 *                   type: string
 *                   description: The name of the organisation
 *                 description:
 *                   type: string
 *                   description: Optional description
 *                 location:
 *                   type: object
 *                   description: Optional UNTP location object
 *                 primaryIdentifierId:
 *                   type: string
 *                   description: ID of the primary identifier
 *                 secondaryIdentifierIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: IDs of secondary identifiers
 *     responses:
 *       201:
 *         description: Organisations created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Organisation'
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
 *         description: Referenced entity not found
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
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info('Validating input parameters');
  if (!Array.isArray(body)) {
    throw new ValidationError('Request body must be an array');
  }

  if (body.length === 0) {
    throw new ValidationError('Request body must not be empty');
  }

  for (const item of body) {
    if (!isNonEmptyString(item.name)) {
      throw new ValidationError('name is required for each organisation');
    }
  }

  logger.info({ count: body.length }, 'Creating organisations');
  const organisations = await createOrganisations(tenantId, body);

  logger.info({ count: organisations.length }, 'Organisations created');
  return NextResponse.json(organisations, { status: 201 });
});

/**
 * @swagger
 * /organisations:
 *   get:
 *     summary: List organisations
 *     description: Retrieves a list of organisations for the authenticated tenant with optional filtering
 *     tags:
 *       - Organisations
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by organisation name or identifier value
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of organisations to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of organisations to skip for pagination
 *     responses:
 *       200:
 *         description: List of organisations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Organisation'
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
  logger.info('Parsing query filters');
  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ filters: { search, limit, offset } }, 'Querying organisations');
  const { data, total } = await listOrganisations(tenantId, { search, limit, offset });

  logger.info({ count: data.length, total }, 'Organisations listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
