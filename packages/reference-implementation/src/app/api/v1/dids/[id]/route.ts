import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, parseRequestBody, definedFields } from '@/lib/api/validation';
import { updateDidRequestSchema } from '@/lib/api/request-schemas/did';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDidById, updateDid, deleteDid } from '@/lib/prisma/repositories';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/dids/[id]' });

/**
 * @swagger
 * /dids/{id}:
 *   get:
 *     summary: Get a DID by ID
 *     description: Retrieves a specific DID by its database ID
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the DID
 *     responses:
 *       200:
 *         description: DID retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Did'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: DID not found
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

  logger.info({ didId: id }, 'Looking up DID');
  const did = await getDidById(id, tenantId);
  if (!did) {
    throw new NotFoundError('DID not found');
  }

  logger.info({ didId: id, did: did.did }, 'DID retrieved');
  return NextResponse.json(did);
});

/**
 * @swagger
 * /dids/{id}:
 *   patch:
 *     summary: Update a DID
 *     description: Updates the name, description, and/or default status of a specific DID
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the DID
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
 *                 description: New name for the DID
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 description: New description for the DID
 *               isDefault:
 *                 type: boolean
 *                 description: Whether to set this DID as the tenant default
 *             anyOf:
 *               - required: [name]
 *               - required: [description]
 *               - required: [isDefault]
 *     responses:
 *       200:
 *         description: DID updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Did'
 *       400:
 *         description: Validation error (e.g. no fields provided, a field of the wrong type, or the system tenant changing isDefault on its own DEFAULT-type DID - any other tenant PATCHing that DID gets a 404 instead, since it is not scoped to their tenant)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: DID not found
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

  logger.info({ didId: id }, 'Validating update fields');
  const body = await parseRequestBody(req, updateDidRequestSchema);
  const fields = definedFields(body);

  logger.info({ didId: id, fields: Object.keys(fields) }, 'Updating DID record');
  const updated = await updateDid(id, tenantId, fields);

  logger.info({ didId: id }, 'DID updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /dids/{id}:
 *   delete:
 *     summary: Delete a DID
 *     description: |
 *       Deletes a DID record. If the DID is managed (has a serviceInstanceId), removal from the upstream
 *       provider is also attempted, on a best-effort basis: the record is already deleted by that point, so
 *       a provider that is unreachable or rejects the removal leaves an orphaned upstream DID and the
 *       request still returns 204.
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the DID
 *     responses:
 *       204:
 *         description: DID deleted successfully
 *       400:
 *         description: Cannot delete a DID currently flagged isDefault - clear the flag via the update endpoint first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: DID not found
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

  logger.info({ didId: id }, 'Looking up DID for deletion');
  const did = await getDidById(id, tenantId);
  if (!did) {
    throw new NotFoundError('DID not found');
  }

  if (did.isDefault) {
    throw new ValidationError(
      'Cannot delete a DID currently flagged isDefault - clear the flag via the update endpoint first',
    );
  }

  logger.info({ didId: id }, 'Deleting DID from database');
  await deleteDid(id, tenantId);

  if (did.serviceInstanceId) {
    try {
      logger.info(
        { didId: id, did: did.did, serviceInstanceId: did.serviceInstanceId },
        'Removing DID from upstream provider',
      );
      const { service: didService } = await resolveDidService(tenantId, did.serviceInstanceId);
      await didService.delete(did.did);
    } catch (err) {
      logger.warn(
        { didId: id, did: did.did, serviceInstanceId: did.serviceInstanceId, error: err },
        'Failed to delete DID from upstream provider; upstream DID may be orphaned',
      );
    }
  }

  logger.info({ didId: id }, 'DID deleted');
  return new Response(null, { status: 204 });
});
