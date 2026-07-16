import { NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/api/validation';
import { importDidRequestSchema } from '@/lib/api/request-schemas/did';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDid, getInstanceByResolution } from '@/lib/prisma/repositories';
import { ServiceInstanceNotFoundError } from '@/lib/api/errors';
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
 *                 minLength: 1
 *                 description: The DID identifier to import (e.g., did:web:example.com)
 *               method:
 *                 type: string
 *                 enum: [DID_WEB]
 *                 description: DID method. did:web is the supported method today; did:webvh is planned but not yet implemented and is rejected.
 *               keyId:
 *                 type: string
 *                 minLength: 1
 *                 description: Key identifier associated with the DID
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: Human-readable name for the DID
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 description: Description of the DID's purpose
 *               serviceInstanceId:
 *                 type: string
 *                 minLength: 1
 *                 description: Service instance ID — the verifiable credential service that holds the key material for this DID
 *     responses:
 *       201:
 *         description: DID imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Did'
 *       400:
 *         description: Validation error (e.g. a missing or non-string did/keyId/serviceInstanceId, an invalid method). A serviceInstanceId deleted in the rare window between resolution and the write can also surface here as a generic validation error.
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
 *         description: Service instance not found, or belongs to a different tenant
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
  logger.info('Validating request body');
  const body = await parseRequestBody(req, importDidRequestSchema);

  // Import never resolves a working adapter (it stores the reference without calling the
  // upstream VC service), so it uses the tenant-scoped existence lookup resolveDidService
  // wraps rather than resolveDidService itself: resolving the full adapter would introduce
  // failure modes (decryption, adapter registry, config validation) this route has no need
  // to depend on. Without this check, an existing service instance belonging to a different
  // tenant would pass the repository's plain FK check and be stored, since the FK is only
  // ServiceInstance.id with no tenancy constraint.
  logger.info({ serviceInstanceId: body.serviceInstanceId }, 'Verifying service instance belongs to this tenant');
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
