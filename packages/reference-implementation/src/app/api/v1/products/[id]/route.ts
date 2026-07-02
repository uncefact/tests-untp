import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateProductRequestSchema } from '@/lib/api/request-schemas/product';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getProductById, updateProduct, deleteProduct } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/products/[id]' });

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
 *                 nullable: true
 *                 description: Updated parent product ID (set to null to clear)
 *               producedByOrganisationId:
 *                 type: string
 *                 nullable: true
 *                 description: Updated producing organisation ID (set to null to clear)
 *               manufacturingFacilityId:
 *                 type: string
 *                 nullable: true
 *                 description: Updated manufacturing facility ID (set to null to clear)
 *               primaryIdentifierId:
 *                 type: string
 *                 nullable: true
 *                 description: Updated primary identifier ID (set to null to clear)
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
 *       409:
 *         description: The identifier is already the primary identifier of another product, or a secondary identifier was concurrently linked by another request
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

  logger.info({ productId: id }, 'Parsing and validating request body');
  const body = await parseRequestBody(req, updateProductRequestSchema);

  logger.info({ productId: id }, 'Updating product');
  const updated = await updateProduct(id, tenantId, definedFields(body));

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
