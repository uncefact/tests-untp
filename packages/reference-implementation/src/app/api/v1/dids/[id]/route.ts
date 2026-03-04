import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
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
 *         description: Unauthorized - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     description: Updates the name and/or description of a specific DID
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the DID
 *               description:
 *                 type: string
 *                 description: New description for the DID
 *               isDefault:
 *                 type: boolean
 *                 description: Whether to set this DID as the tenant default
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: DID updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Did'
 *       400:
 *         description: Validation error - at least one field required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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

  logger.info({ didId: id }, 'Parsing request body');
  let body: { name?: string; description?: string; isDefault?: boolean };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ didId: id }, 'Validating update fields');
  const hasName = isNonEmptyString(body.name);
  const hasDescription = isNonEmptyString(body.description);
  const hasIsDefault = typeof body.isDefault === 'boolean';

  if (!hasName && !hasDescription && !hasIsDefault) {
    throw new ValidationError('At least one of name, description, or isDefault is required');
  }

  if (hasIsDefault) {
    const existing = await getDidById(id, tenantId);
    if (!existing) {
      throw new NotFoundError('DID not found');
    }
    if (existing.type === 'DEFAULT') {
      throw new ValidationError('Cannot modify default status of system DIDs');
    }
  }

  logger.info({ didId: id, fields: { hasName, hasDescription, hasIsDefault } }, 'Updating DID record');
  const updated = await updateDid(id, tenantId, {
    ...(hasName && { name: body.name }),
    ...(hasDescription && { description: body.description }),
    ...(hasIsDefault && { isDefault: body.isDefault }),
  });

  logger.info({ didId: id }, 'DID updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /dids/{id}:
 *   delete:
 *     summary: Delete a DID
 *     description: Deletes a DID. If the DID is managed (has a serviceInstanceId), it is also removed from the upstream provider.
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
 *         description: Cannot delete the system default DID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
    throw new ValidationError('Cannot delete system default DID');
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
      logger.error(
        { didId: id, did: did.did, error: err },
        'Best-effort upstream DID deletion failed; orphaned upstream DID is harmless',
      );
    }
  }

  logger.info({ didId: id }, 'DID deleted');
  return new Response(null, { status: 204 });
});
