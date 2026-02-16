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
 *               type: object
 *               properties:
 *                 organisation:
 *                   $ref: '#/components/schemas/Organisation'
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
  logger.info({ tenantId, organisationId: id }, 'Looking up organisation');
  const organisation = await getOrganisationById(id, tenantId);
  if (!organisation) {
    throw new NotFoundError('Organisation not found');
  }
  return NextResponse.json({ organisation });
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
 *                 type: string
 *                 description: Updated location
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
 *               type: object
 *               properties:
 *                 organisation:
 *                   $ref: '#/components/schemas/Organisation'
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const hasUpdatableField = UPDATABLE_FIELDS.some((field) => field in body);
  if (!hasUpdatableField) {
    throw new ValidationError(`At least one updatable field must be provided: ${UPDATABLE_FIELDS.join(', ')}`);
  }

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }

  logger.info({ tenantId, organisationId: id }, 'Updating organisation');
  const organisation = await updateOrganisation(id, tenantId, body as UpdateOrganisationInput);

  logger.info({ tenantId, organisationId: id }, 'Organisation updated');
  return NextResponse.json({ organisation });
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
 *       200:
 *         description: Organisation deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
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

  logger.info({ tenantId, organisationId: id }, 'Deleting organisation');
  await deleteOrganisation(id, tenantId);

  logger.info({ tenantId, organisationId: id }, 'Organisation deleted');
  return NextResponse.json({});
});
