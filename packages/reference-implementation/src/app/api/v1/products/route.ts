import { NextResponse } from 'next/server';
import {
  ValidationError,
  isNonEmptyString,
  parsePositiveInt,
  parseNonNegativeInt,
  validateEnum,
} from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createProducts, listProducts, CreateProductInput } from '@/lib/prisma/repositories';
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
 *     responses:
 *       201:
 *         description: Products created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
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
  let body: Array<{
    name?: string;
    level?: string;
    description?: string;
    parentId?: string;
  }>;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (!Array.isArray(body)) {
    throw new ValidationError('Request body must be an array');
  }

  if (body.length === 0) {
    throw new ValidationError('Request body must not be empty');
  }

  for (const item of body) {
    if (!isNonEmptyString(item.name)) {
      throw new ValidationError('name is required for all items');
    }
    if (!isNonEmptyString(item.level)) {
      throw new ValidationError('level is required for all items');
    }
    validateEnum(item.level, PRODUCT_LEVELS, 'level');
  }

  logger.info({ tenantId, count: body.length }, 'Creating products');
  const products = await createProducts(tenantId, body as CreateProductInput[]);

  logger.info({ tenantId, count: products.length }, 'Products created');
  return NextResponse.json({ products }, { status: 201 });
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
 *         description: Search products by name
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
 *         description: Filter by brand organisation ID
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
 *                 products:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
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
  const search = url.searchParams.get('search') ?? undefined;
  const level = validateEnum(url.searchParams.get('level') ?? undefined, PRODUCT_LEVELS, 'level');
  const parentId = url.searchParams.get('parentId') ?? undefined;
  const organisationId = url.searchParams.get('organisationId') ?? undefined;
  const facilityId = url.searchParams.get('facilityId') ?? undefined;
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, search, level, parentId, organisationId, facilityId, limit, offset }, 'Listing products');
  const products = await listProducts(tenantId, { search, level, parentId, organisationId, facilityId, limit, offset });

  logger.info({ tenantId, count: products.length }, 'Products listed');
  return NextResponse.json({ products });
});
