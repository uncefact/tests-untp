import { NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/api/validation';
import { importDidRequestSchema } from '@/lib/api/request-schemas/did';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { createDid, getInstanceByResolution } from '@/lib/prisma/repositories';
import { ServiceType } from '@uncefact/untp-ri-services';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/dids/import' });

/**
 * @swagger
 * /dids/import:
 *   post:
 *     tags: [DIDs]
 *     summary: Import an externally managed DID
 *     description: Registers an existing DID locally without calling the adapter create method. Sets status to UNVERIFIED for subsequent verification.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - did
 *               - method
 *               - keyId
 *               - serviceInstanceId
 *             properties:
 *               did:
 *                 type: string
 *                 description: The DID identifier to import (e.g., did:web:example.com)
 *               method:
 *                 type: string
 *                 enum: [DID_WEB]
 *                 description: DID method
 *               keyId:
 *                 type: string
 *                 description: Key identifier associated with the DID
 *               name:
 *                 type: string
 *                 description: Human-readable name for the DID
 *               description:
 *                 type: string
 *                 description: Description of the DID's purpose
 *               serviceInstanceId:
 *                 type: string
 *                 description: Service instance ID — the verifiable credential service that holds the key material for this DID
 *     responses:
 *       201:
 *         description: DID imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Did'
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
 *         description: Service instance not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: A DID record with this DID already exists
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  logger.info('Parsing and validating request body');
  const body = await parseRequestBody(req, importDidRequestSchema);

  // The imported record's serviceInstanceId is later used to resolve the
  // signing service, so the instance must exist and be visible to this tenant
  // (matching the resolution scoping POST /dids applies).
  logger.info({ serviceInstanceId: body.serviceInstanceId }, 'Validating service instance reference');
  const instance = await getInstanceByResolution(tenantId, ServiceType.VC, body.serviceInstanceId);
  if (!instance) {
    throw new ServiceInstanceNotFoundError(body.serviceInstanceId);
  }

  logger.info({ did: body.did, method: body.method }, 'Saving imported DID record');
  const record = await createDid({
    tenantId,
    did: body.did,
    type: 'SELF_MANAGED',
    method: body.method,
    keyId: body.keyId,
    name: body.name ?? body.did,
    description: body.description,
    status: 'UNVERIFIED',
    serviceInstanceId: body.serviceInstanceId,
  });

  logger.info({ didId: record.id, did: record.did }, 'DID imported');
  return NextResponse.json(record, { status: 201 });
});
