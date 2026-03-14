import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createFacilities, listFacilities } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/facilities' });

/**
 * @swagger
 * /facilities:
 *   post:
 *     summary: Create one or more facilities
 *     description: Creates one or more facilities from an array of inputs. Each item must include a name.
 *     tags:
 *       - Facilities
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
 *                   description: Name of the facility
 *                 description:
 *                   type: string
 *                   description: Optional description
 *                 location:
 *                   type: object
 *                   description: Optional UNTP location object
 *                 operatingOrganisationId:
 *                   type: string
 *                   description: ID of the operating organisation
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
 *         description: Facilities created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Facility'
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
  logger.info({ tenantId }, 'Parsing request body');
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ tenantId }, 'Validating input parameters');
  if (!Array.isArray(body)) {
    throw new ValidationError('Request body must be an array');
  }

  if (body.length === 0) {
    throw new ValidationError('Request body must not be empty');
  }

  for (const item of body) {
    if (!isNonEmptyString(item.name)) {
      throw new ValidationError('name is required for each facility');
    }
  }

  logger.info({ tenantId, count: body.length }, 'Creating facilities');
  const facilities = await createFacilities(tenantId, body);

  logger.info({ tenantId, count: facilities.length }, 'Facilities created');
  return NextResponse.json(facilities, { status: 201 });
});

/**
 * @swagger
 * /facilities:
 *   get:
 *     summary: List facilities
 *     description: Retrieves a list of facilities for the authenticated tenant with optional filtering
 *     tags:
 *       - Facilities
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by facility name or identifier value
 *       - in: query
 *         name: organisationId
 *         schema:
 *           type: string
 *         description: Filter by operating organisation ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of facilities to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of facilities to skip for pagination
 *     responses:
 *       200:
 *         description: Paginated list of facilities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Facility'
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
  logger.info({ tenantId }, 'Parsing query parameters');
  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? undefined;
  const organisationId = url.searchParams.get('organisationId') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, search, organisationId, limit, offset }, 'Listing facilities');
  const { data, total } = await listFacilities(tenantId, { search, organisationId, limit, offset });

  logger.info({ tenantId, count: data.length }, 'Facilities listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
