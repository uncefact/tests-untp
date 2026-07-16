import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateSchemeRequestSchema } from '@/lib/api/request-schemas/scheme';
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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
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
 *       description: At least one recognised field is required; unknown keys are ignored.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: New name for the scheme
 *               primaryKey:
 *                 type: string
 *                 minLength: 1
 *                 description: New primary key identifier
 *               validationPattern:
 *                 type: string
 *                 minLength: 1
 *                 description: New validation pattern. Rejected with a 400 if it does not compile as a regular expression.
 *               linkTemplate:
 *                 type: string
 *                 minLength: 1
 *                 description: New ISO 18975 link template for URI construction
 *               idrServiceInstanceId:
 *                 type: string
 *                 minLength: 1
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
 *                       minLength: 1
 *                     description:
 *                       type: string
 *                       minLength: 1
 *                     validationPattern:
 *                       type: string
 *                       minLength: 1
 *                       description: Rejected with a 400 if it does not compile as a regular expression.
 *                     order:
 *                       type: integer
 *                       format: int32
 *                       minimum: 0
 *                       maximum: 2147483647
 *                       description: Qualifier precedence in URI ordering (ascending). Defaults to 0.
 *             anyOf:
 *               - required: [name]
 *               - required: [primaryKey]
 *               - required: [validationPattern]
 *               - required: [linkTemplate]
 *               - required: [idrServiceInstanceId]
 *               - required: [qualifiers]
 *     responses:
 *       200:
 *         description: Scheme updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IdentifierScheme'
 *       400:
 *         description: Validation error (e.g. no fields provided, a validationPattern that does not compile as a regular expression, a duplicate qualifier key, an idrServiceInstanceId that does not reference an existing service instance)
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
  logger.info({ schemeId: id }, 'Validating update fields');

  const body = await parseRequestBody(req, updateSchemeRequestSchema);
  const fields = definedFields(body);

  logger.info({ schemeId: id, fields: Object.keys(fields) }, 'Updating scheme');
  const updated = await updateIdentifierScheme(id, tenantId, fields);

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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
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
