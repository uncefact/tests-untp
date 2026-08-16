import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateOrganisationRequestSchema } from '@/lib/api/request-schemas/organisation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getOrganisationById, updateOrganisation, deleteOrganisation } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/organisations/[id]' });

/**
 * @swagger
 * /organisations/{id}:
 *   get:
 *     summary: Get an organisation by ID
 *     description: Retrieves a specific organisation by its database ID
 *     tags:
 *       - Organisations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the organisation
 *     responses:
 *       200:
 *         description: Organisation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Organisation'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Organisation not found
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
  logger.info({ organisationId: id }, 'Looking up organisation');
  const organisation = await getOrganisationById(id, tenantId);
  if (!organisation) {
    throw new NotFoundError('Organisation not found');
  }
  logger.info({ organisationId: id }, 'Organisation retrieved');
  return NextResponse.json(organisation);
});

/**
 * @swagger
 * /organisations/{id}:
 *   patch:
 *     summary: Update an organisation
 *     description: Updates one or more fields of a specific organisation
 *     tags:
 *       - Organisations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the organisation
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
 *                 description: Updated name of the organisation
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: Updated description (set to null to clear)
 *               location:
 *                 type: object
 *                 description: Updated location object. Any JSON object is accepted; the UNTP location field shapes described in the master data documentation are not currently validated.
 *               primaryIdentifierId:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: ID of the primary identifier (set to null to clear)
 *               secondaryIdentifierIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   minLength: 1
 *                 description: IDs of secondary identifiers (replaces the existing set; an empty array clears all secondary identifiers). Must not contain duplicates.
 *             anyOf:
 *               - required: [name]
 *               - required: [description]
 *               - required: [location]
 *               - required: [primaryIdentifierId]
 *               - required: [secondaryIdentifierIds]
 *     responses:
 *       200:
 *         description: Organisation updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Organisation'
 *       400:
 *         description: Validation error (e.g. no updatable field provided, a mistyped field, a non-array secondaryIdentifierIds, or a referenced primary identifier that no longer exists by the time the update is written)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Organisation not found, or a referenced primary or secondary identifier does not exist
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The identifier is already the primary identifier of another organisation, or a secondary identifier was concurrently linked by another request
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
  logger.info({ organisationId: id }, 'Validating update fields');

  const body = await parseRequestBody(req, updateOrganisationRequestSchema);
  const fields = definedFields(body);

  logger.info({ organisationId: id, fields: Object.keys(fields) }, 'Updating organisation');
  const updated = await updateOrganisation(id, tenantId, fields);

  logger.info({ organisationId: id }, 'Organisation updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /organisations/{id}:
 *   delete:
 *     summary: Delete an organisation
 *     description: Deletes a specific organisation by its database ID
 *     tags:
 *       - Organisations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the organisation
 *     responses:
 *       204:
 *         description: Organisation deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Organisation not found
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

  logger.info({ organisationId: id }, 'Deleting organisation');
  await deleteOrganisation(id, tenantId);

  logger.info({ organisationId: id }, 'Organisation deleted');
  return new NextResponse(null, { status: 204 });
});
