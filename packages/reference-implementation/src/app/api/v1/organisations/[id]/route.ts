import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import {
  getOrganisationById,
  updateOrganisation,
  deleteOrganisation,
  UpdateOrganisationInput,
} from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/organisations/[id]' });

const UPDATABLE_FIELDS = ['name', 'description', 'location', 'primaryIdentifierId', 'secondaryIdentifierIds'] as const;

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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated name of the organisation
 *               description:
 *                 type: string
 *                 description: Updated description
 *               location:
 *                 type: object
 *                 description: Updated UNTP location object
 *               primaryIdentifierId:
 *                 type: string
 *                 description: ID of the primary identifier
 *               secondaryIdentifierIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: IDs of secondary identifiers
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Organisation updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Organisation'
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
 *         description: Organisation not found
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

  logger.info({ organisationId: id }, 'Parsing request body');
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ organisationId: id }, 'Validating update fields');
  const hasUpdatableField = UPDATABLE_FIELDS.some((field) => field in body);
  if (!hasUpdatableField) {
    throw new ValidationError(`At least one updatable field must be provided: ${UPDATABLE_FIELDS.join(', ')}`);
  }

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }

  const updateData: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  logger.info({ organisationId: id }, 'Updating organisation');
  const updated = await updateOrganisation(id, tenantId, updateData as UpdateOrganisationInput);

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
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
