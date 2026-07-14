import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getFacilityById, updateFacility, deleteFacility, UpdateFacilityInput } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/facilities/[id]' });

/** Fields that may be updated on a facility. */
const UPDATABLE_FIELDS = [
  'name',
  'description',
  'location',
  'operatingOrganisationId',
  'primaryIdentifierId',
  'secondaryIdentifierIds',
] as const;

/**
 * @swagger
 * /facilities/{id}:
 *   get:
 *     summary: Get a facility by ID
 *     description: Retrieves a specific facility by its database ID
 *     tags:
 *       - Facilities
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the facility
 *     responses:
 *       200:
 *         description: Facility retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Facility'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Facility not found
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
  logger.info({ facilityId: id }, 'Looking up facility');
  const facility = await getFacilityById(id, tenantId);
  if (!facility) {
    throw new NotFoundError('Facility not found');
  }
  logger.info({ facilityId: id }, 'Facility retrieved');
  return NextResponse.json(facility);
});

/**
 * @swagger
 * /facilities/{id}:
 *   patch:
 *     summary: Update a facility
 *     description: Updates one or more fields of a specific facility
 *     tags:
 *       - Facilities
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the facility
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated facility name
 *               description:
 *                 type: string
 *                 description: Updated description
 *               location:
 *                 type: object
 *                 description: Updated UNTP location object
 *               operatingOrganisationId:
 *                 type: string
 *                 nullable: true
 *                 description: ID of the operating organisation (null to clear)
 *               primaryIdentifierId:
 *                 type: string
 *                 nullable: true
 *                 description: ID of the primary identifier (null to clear)
 *               secondaryIdentifierIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: IDs of secondary identifiers (replaces existing)
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Facility updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Facility'
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
 *         description: Facility not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The identifier is already the primary identifier of another facility, or a secondary identifier was concurrently linked by another request
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

  logger.info({ facilityId: id }, 'Parsing request body');
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ facilityId: id }, 'Validating update fields');
  // Ensure at least one updatable field is present
  const hasUpdatableField = UPDATABLE_FIELDS.some((field) => field in body);
  if (!hasUpdatableField) {
    throw new ValidationError(`At least one updatable field is required: ${UPDATABLE_FIELDS.join(', ')}`);
  }

  // Validate name if provided — must be a non-empty string
  if ('name' in body && !isNonEmptyString(body.name)) {
    throw new ValidationError('name must be a non-empty string');
  }

  const updateData: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  logger.info({ facilityId: id }, 'Updating facility');
  const updated = await updateFacility(id, tenantId, updateData as UpdateFacilityInput);

  logger.info({ facilityId: id }, 'Facility updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /facilities/{id}:
 *   delete:
 *     summary: Delete a facility
 *     description: Deletes a specific facility by its database ID
 *     tags:
 *       - Facilities
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the facility
 *     responses:
 *       204:
 *         description: Facility deleted successfully
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Facility not found
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

  logger.info({ facilityId: id }, 'Deleting facility');
  await deleteFacility(id, tenantId);

  logger.info({ facilityId: id }, 'Facility deleted');
  return new NextResponse(null, { status: 204 });
});
