import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateFacilityRequestSchema } from '@/lib/api/request-schemas/facility';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getFacilityById, updateFacility, deleteFacility } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/facilities/[id]' });

/**
 * @swagger
 * /facilities/{id}:
 *   get:
 *     summary: Get a facility by ID
 *     description: Retrieves a specific facility by its database ID, including its primary identifier (with scheme and registrar), secondary identifiers, and operating organisation
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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
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
 *       description: At least one recognised field is required; unknown keys are ignored.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: Updated facility name
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: Updated description (set to null to clear)
 *               location:
 *                 type: object
 *                 description: Updated UNTP location object. Rejected with a 400 if provided as null; there is no clear mechanism for this field yet
 *               operatingOrganisationId:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: ID of the operating organisation (set to null to clear)
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
 *                 description: IDs of secondary identifiers, each unique within the array (an empty array clears them, replaces existing otherwise)
 *             anyOf:
 *               - required: [name]
 *               - required: [description]
 *               - required: [location]
 *               - required: [operatingOrganisationId]
 *               - required: [primaryIdentifierId]
 *               - required: [secondaryIdentifierIds]
 *     responses:
 *       200:
 *         description: Facility updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Facility'
 *       400:
 *         description: Validation error (e.g. no updatable field provided, a non-array or duplicated secondaryIdentifierIds, an overlapping primary/secondary identifier, a referenced record that no longer exists)
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
 *         description: Facility not found, or a referenced organisation or identifier not found
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

  logger.info({ facilityId: id }, 'Validating update fields');
  const body = await parseRequestBody(req, updateFacilityRequestSchema);
  const fields = definedFields(body);

  logger.info({ facilityId: id, fields: Object.keys(fields) }, 'Updating facility');
  const updated = await updateFacility(id, tenantId, fields);

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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
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
