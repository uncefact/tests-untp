import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateIdentifierSchemeRequestSchema } from '@/lib/api/request-schemas/identifier-scheme';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierSchemeById, updateIdentifierScheme, deleteIdentifierScheme } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/schemes/[id]' });

/**
 * @swagger
 * /schemes/{id}:
 *   get:
 *     summary: Get an identifier scheme by ID
 *     description: Retrieves a specific identifier scheme by its database ID
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     responses:
 *       200:
 *         description: Scheme retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IdentifierScheme'
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  logger.info({ schemeId: id }, 'Looking up scheme');
  const scheme = await getIdentifierSchemeById(id, tenantId);
  if (!scheme) {
    throw new NotFoundError('Identifier scheme not found');
  }
  logger.info({ schemeId: id }, 'Scheme retrieved');
  return NextResponse.json(scheme);
});

/**
 * @swagger
 * /schemes/{id}:
 *   patch:
 *     summary: Update an identifier scheme
 *     description: Updates the fields of a specific identifier scheme. When qualifiers are provided, existing qualifiers are replaced entirely.
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the scheme
 *               primaryKey:
 *                 type: string
 *                 description: New primary key identifier
 *               validationPattern:
 *                 type: string
 *                 description: New validation pattern
 *               linkTemplate:
 *                 type: string
 *                 description: New ISO 18975 link template for URI construction
 *               idrServiceInstanceId:
 *                 type: string
 *                 nullable: true
 *                 description: New IDR service instance ID (set to null to clear)
 *               qualifiers:
 *                 type: array
 *                 description: Replacement qualifiers (replaces all existing qualifiers)
 *                 items:
 *                   type: object
 *                   required:
 *                     - key
 *                     - description
 *                     - validationPattern
 *                   properties:
 *                     key:
 *                       type: string
 *                     description:
 *                       type: string
 *                     validationPattern:
 *                       type: string
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Scheme updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IdentifierScheme'
 *       400:
 *         description: Validation error - at least one field required
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
 *         description: An identifier scheme with this primary key already exists for the registrar, or a qualifier with this key already exists for the scheme
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
  logger.info({ schemeId: id }, 'Parsing and validating request body');
  const body = await parseRequestBody(req, updateIdentifierSchemeRequestSchema);

  logger.info({ schemeId: id }, 'Updating scheme');
  const updated = await updateIdentifierScheme(id, tenantId, definedFields(body));

  logger.info({ schemeId: id }, 'Scheme updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /schemes/{id}:
 *   delete:
 *     summary: Delete an identifier scheme
 *     description: Deletes a specific identifier scheme by its database ID
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     responses:
 *       204:
 *         description: Scheme deleted successfully
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
 *         description: The identifier scheme has identifiers and cannot be deleted
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

  logger.info({ schemeId: id }, 'Deleting scheme');
  await deleteIdentifierScheme(id, tenantId);

  logger.info({ schemeId: id }, 'Scheme deleted');
  return new Response(null, { status: 204 });
});
