import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody } from '@/lib/api/validation';
import { updateIdentifierRequestSchema } from '@/lib/api/request-schemas/identifier';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierById, updateIdentifier, deleteIdentifier } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/identifiers/[id]' });

/**
 * @swagger
 * /identifiers/{id}:
 *   get:
 *     summary: Get an identifier by ID
 *     description: Retrieves a specific identifier by its database ID
 *     tags:
 *       - Identifiers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the identifier
 *     responses:
 *       200:
 *         description: Identifier retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Identifier'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Identifier not found
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
  logger.info({ identifierId: id }, 'Looking up identifier');
  const identifier = await getIdentifierById(id, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }
  logger.info({ identifierId: id }, 'Identifier retrieved');
  return NextResponse.json(identifier);
});

/**
 * @swagger
 * /identifiers/{id}:
 *   patch:
 *     summary: Update an identifier
 *     description: Updates the value of a specific identifier. The new value is re-validated against the scheme's pattern.
 *     tags:
 *       - Identifiers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the identifier
 *     requestBody:
 *       required: true
 *       description: The new value must contain at least one non-whitespace character; a whitespace-only value is rejected with a 400.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: string
 *                 minLength: 1
 *                 description: New value for the identifier (re-validated against scheme pattern)
 *     responses:
 *       200:
 *         description: Identifier updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Identifier'
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
 *         description: Identifier not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An identifier with this value already exists for the scheme
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
  logger.info({ identifierId: id }, 'Validating update fields');

  const body = await parseRequestBody(req, updateIdentifierRequestSchema);

  logger.info({ identifierId: id }, 'Updating identifier');
  const updated = await updateIdentifier(id, tenantId, {
    value: body.value,
  });

  logger.info({ identifierId: id }, 'Identifier updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /identifiers/{id}:
 *   delete:
 *     summary: Delete an identifier
 *     description: Deletes a specific identifier by its database ID
 *     tags:
 *       - Identifiers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the identifier
 *     responses:
 *       204:
 *         description: Identifier deleted successfully
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Identifier not found
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

  logger.info({ identifierId: id }, 'Deleting identifier');
  await deleteIdentifier(id, tenantId);

  logger.info({ identifierId: id }, 'Identifier deleted');
  return new Response(null, { status: 204 });
});
