import { NextResponse } from 'next/server';
import { parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { createProductsRequestSchema, listProductsQuerySchema } from '@/lib/api/request-schemas/product';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createProducts, listProducts } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/products' });

/**
 * @swagger
 * /products:
 *   post:
 *     summary: Create one or more products
 *     description: Creates products in bulk. Each item must include a name and a valid product level.
 *     tags:
 *       - Products
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             minItems: 1
 *             description: Optional fields are omitted rather than sent as null; an explicit null is rejected with a 400.
 *             items:
 *               type: object
 *               required:
 *                 - name
 *                 - level
 *               properties:
 *                 name:
 *                   type: string
 *                   minLength: 1
 *                   description: The product name
 *                 level:
 *                   type: string
 *                   enum: [MODEL, BATCH, ITEM]
 *                   description: The product level
 *                 description:
 *                   type: string
 *                   minLength: 1
 *                   description: Optional product description
 *                 parentId:
 *                   type: string
 *                   minLength: 1
 *                   description: Optional parent product ID
 *                 producedByOrganisationId:
 *                   type: string
 *                   minLength: 1
 *                   description: ID of the producing organisation
 *                 manufacturingFacilityId:
 *                   type: string
 *                   minLength: 1
 *                   description: ID of the manufacturing facility
 *                 primaryIdentifierId:
 *                   type: string
 *                   minLength: 1
 *                   description: ID of the primary identifier
 *                 secondaryIdentifierIds:
 *                   type: array
 *                   uniqueItems: true
 *                   items:
 *                     type: string
 *                     minLength: 1
 *                   description: IDs of secondary identifiers
 *     responses:
 *       201:
 *         description: Products created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 *       400:
 *         description: Validation error (e.g. a body that is not a non-empty array, a missing or empty name, an invalid level, an optional field sent as null, a non-array or duplicated secondaryIdentifierIds)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Referenced entity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An identifier in this request is already the primary identifier of another product
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
  const body = await parseRequestBody(req, createProductsRequestSchema);

  logger.info({ count: body.length }, 'Creating products');
  const products = await createProducts(tenantId, body);

  logger.info({ count: products.length }, 'Products created');
  return NextResponse.json(products, { status: 201 });
});

/**
 * @swagger
 * /products:
 *   get:
 *     summary: List products
 *     description: Retrieves a list of products for the authenticated tenant with optional filtering
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by product name or identifier value
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [MODEL, BATCH, ITEM]
 *         description: Filter by product level
 *       - in: query
 *         name: parentId
 *         schema:
 *           type: string
 *         description: Filter by parent product ID
 *       - in: query
 *         name: organisationId
 *         schema:
 *           type: string
 *         description: Filter by producing organisation ID
 *       - in: query
 *         name: facilityId
 *         schema:
 *           type: string
 *         description: Filter by manufacturing facility ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of products to return per page. Defaults to 20 unless the deployment maximum is lower. Values above the deployment maximum are rejected with a 400 naming the maximum.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of products to skip for pagination
 *     responses:
 *       200:
 *         description: List of products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error (e.g. a non-integer limit/offset, a negative offset, a limit above the maximum, an invalid level, a repeated query parameter)
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
  const query = parseQueryParams(new URL(req.url), listProductsQuerySchema);
  const { search, level, parentId, organisationId, facilityId, limit, offset } = query;

  logger.info({ filters: { search, level, parentId, organisationId, facilityId, limit, offset } }, 'Querying products');
  const { data, total } = await listProducts(tenantId, {
    search,
    level,
    parentId,
    organisationId,
    facilityId,
    limit,
    offset,
  });

  logger.info({ count: data.length, total }, 'Products listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
