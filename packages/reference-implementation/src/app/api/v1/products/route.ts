import { NextResponse } from 'next/server';
import { parseRequestBody, parsePositiveInt, parseNonNegativeInt, validateEnum } from '@/lib/api/validation';
import { createProductsRequestSchema } from '@/lib/api/request-schemas/product';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createProducts, listProducts } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/products' });

const PRODUCT_LEVELS = ['MODEL', 'BATCH', 'ITEM'] as const;

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
 *             items:
 *               type: object
 *               required:
 *                 - name
 *                 - level
 *               properties:
 *                 name:
 *                   type: string
 *                   description: The product name
 *                 level:
 *                   type: string
 *                   enum: [MODEL, BATCH, ITEM]
 *                   description: The product level
 *                 description:
 *                   type: string
 *                   description: Optional product description
 *                 parentId:
 *                   type: string
 *                   description: Optional parent product ID
 *                 producedByOrganisationId:
 *                   type: string
 *                   description: ID of the producing organisation
 *                 manufacturingFacilityId:
 *                   type: string
 *                   description: ID of the manufacturing facility
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
 *         description: Products created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
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
  logger.info('Parsing and validating request body');
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
 *         description: Maximum number of products to return
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
  const level = validateEnum(url.searchParams.get('level') ?? undefined, PRODUCT_LEVELS, 'level');
  const parentId = url.searchParams.get('parentId') ?? undefined;
  const organisationId = url.searchParams.get('organisationId') ?? undefined;
  const facilityId = url.searchParams.get('facilityId') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

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
