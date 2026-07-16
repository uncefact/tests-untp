import { NextResponse } from 'next/server';
import { parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { createOrganisationsRequestSchema, listOrganisationsQuerySchema } from '@/lib/api/request-schemas/organisation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createOrganisations, listOrganisations } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
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
 *       description: Unknown keys on any item are ignored.
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
 *                   description: The name of the organisation
 *                 description:
 *                   type: string
 *                   minLength: 1
 *                   description: Optional description
 *                 location:
 *                   type: object
 *                   description: Optional location object. Any JSON object is accepted; the UNTP location field shapes described in the master data documentation are not currently validated.
 *                 primaryIdentifierId:
 *                   type: string
 *                   minLength: 1
 *                   description: ID of the primary identifier
 *                 secondaryIdentifierIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                     minLength: 1
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
 *         description: Validation error (e.g. body not a non-empty array, a missing or mistyped name, a non-array secondaryIdentifierIds)
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
 *         description: Referenced entity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An identifier in this request is already the primary identifier of another organisation
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
  const body = await parseRequestBody(req, createOrganisationsRequestSchema);

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
 *         description: Number of organisations to return per page. Defaults to 20 unless the deployment maximum is lower. Values above the deployment maximum are rejected with a 400.
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
  logger.info('Parsing query filters');
  const { search, limit, offset } = parseQueryParams(new URL(req.url), listOrganisationsQuerySchema);

  logger.info({ filters: { search, limit, offset } }, 'Querying organisations');
  const { data, total } = await listOrganisations(tenantId, { search, limit, offset });

  logger.info({ count: data.length, total }, 'Organisations listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
