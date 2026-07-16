import { NextResponse } from 'next/server';
import { parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { createFacilitiesRequestSchema, listFacilitiesQuerySchema } from '@/lib/api/request-schemas/facility';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createFacilities, listFacilities } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/facilities' });

/**
 * @swagger
 * /facilities:
 *   post:
 *     summary: Create one or more facilities
 *     description: Creates one or more facilities from a non-empty array of inputs. Each item must include a name.
 *     tags:
 *       - Facilities
 *     requestBody:
 *       required: true
 *       description: Unrecognised keys on each item are ignored. Every optional field below must be OMITTED to skip it; sending it as an explicit JSON null is rejected with a 400 for the whole request, including location (which previously accepted null as a silent no-op).
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             minItems: 1
 *             items:
 *               type: object
 *               required:
 *                 - name
 *               properties:
 *                 name:
 *                   type: string
 *                   minLength: 1
 *                   description: Name of the facility
 *                 description:
 *                   type: string
 *                   minLength: 1
 *                   description: Optional description. Omit to skip; null is rejected with a 400
 *                 location:
 *                   type: object
 *                   description: Optional UNTP location object. Omit to skip; null is rejected with a 400
 *                 operatingOrganisationId:
 *                   type: string
 *                   minLength: 1
 *                   description: ID of the operating organisation. Omit to skip; null is rejected with a 400
 *                 primaryIdentifierId:
 *                   type: string
 *                   minLength: 1
 *                   description: ID of the primary identifier. Omit to skip; null is rejected with a 400
 *                 secondaryIdentifierIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                     minLength: 1
 *                   description: IDs of secondary identifiers, each unique within the array. Omit to skip; null is rejected with a 400
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
 *         description: Validation error (e.g. a body that is not a non-empty array, a missing or empty name, a non-array or duplicated secondaryIdentifierIds, an overlapping primary/secondary identifier, a referenced record that no longer exists)
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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Referenced organisation or identifier not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An identifier in this request is already the primary identifier of another facility
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
  const body = await parseRequestBody(req, createFacilitiesRequestSchema);

  logger.info({ count: body.length }, 'Creating facilities');
  const facilities = await createFacilities(tenantId, body);

  logger.info({ count: facilities.length }, 'Facilities created');
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
 *         description: Number of facilities to return per page. Defaults to 20 unless the deployment maximum is lower. Values above the deployment maximum are rejected with a 400.
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
 *         description: Validation error (e.g. a non-integer limit/offset, a negative offset, a limit above the maximum, a repeated query parameter)
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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
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
  const query = parseQueryParams(new URL(req.url), listFacilitiesQuerySchema);
  const { search, organisationId, limit, offset } = query;

  logger.info({ filters: { search, organisationId, limit, offset } }, 'Querying facilities');
  const { data, total } = await listFacilities(tenantId, { search, organisationId, limit, offset });

  logger.info({ count: data.length, total }, 'Facilities listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
