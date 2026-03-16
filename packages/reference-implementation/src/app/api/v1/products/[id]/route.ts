import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getProductById, updateProduct, deleteProduct, UpdateProductInput } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/products/[id]' });

/** Fields that may be updated via PATCH. Level is immutable. */
const UPDATABLE_FIELDS = [
  'name',
  'description',
  'parentId',
  'producedByOrganisationId',
  'manufacturingFacilityId',
  'primaryIdentifierId',
  'secondaryIdentifierIds',
] as const;

/**
 * @swagger
 * /products/{id}:
 *   get:
 *     summary: Get a product by ID
 *     description: Retrieves a specific product by its database ID
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the product
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Product not found
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
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  logger.info({ productId: id }, 'Looking up product');
  const product = await getProductById(id, tenantId);
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  logger.info({ productId: id }, 'Product retrieved');
  return NextResponse.json(product);
});

/**
 * @swagger
 * /products/{id}:
 *   patch:
 *     summary: Update a product
 *     description: >
 *       Updates an existing product. The product level is immutable and cannot be changed.
 *       At least one updatable field must be provided.
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the product
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated product name
 *               description:
 *                 type: string
 *                 description: Updated product description
 *               parentId:
 *                 type: string
 *                 description: Updated parent product ID
 *               producedByOrganisationId:
 *                 type: string
 *                 description: Updated producing organisation ID
 *               manufacturingFacilityId:
 *                 type: string
 *                 description: Updated manufacturing facility ID
 *               primaryIdentifierId:
 *                 type: string
 *                 description: Updated primary identifier ID
 *               secondaryIdentifierIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Updated secondary identifier IDs
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
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
 *         description: Product not found
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
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ productId: id }, 'Parsing request body');
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ productId: id }, 'Validating update fields');
  const hasUpdatableField = UPDATABLE_FIELDS.some((field) => field in body);
  if (!hasUpdatableField) {
    throw new ValidationError(`At least one updatable field must be provided: ${UPDATABLE_FIELDS.join(', ')}`);
  }

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }

  // Pick only known updatable fields (level is immutable and silently excluded)
  const updateData: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  logger.info({ productId: id }, 'Updating product');
  const updated = await updateProduct(id, tenantId, updateData as UpdateProductInput);

  logger.info({ productId: id }, 'Product updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /products/{id}:
 *   delete:
 *     summary: Delete a product
 *     description: Deletes a specific product by its database ID
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the product
 *     responses:
 *       204:
 *         description: Product deleted successfully
 *       400:
 *         description: Validation error — cannot delete product with dependent children
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
 *         description: Product not found
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
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ productId: id }, 'Deleting product');
  await deleteProduct(id, tenantId);

  logger.info({ productId: id }, 'Product deleted');
  return new NextResponse(null, { status: 204 });
});
