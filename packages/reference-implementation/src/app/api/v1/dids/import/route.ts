import { NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/api/validation';
import { importDidRequestSchema } from '@/lib/api/request-schemas/did';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDid } from '@/lib/prisma/repositories';
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
 *                 enum: [DID_WEB, DID_WEB_VH]
 *                 description: DID method
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
 *         description: Validation error (e.g. a missing or non-string did/keyId/serviceInstanceId, an invalid method, or a serviceInstanceId that does not reference an existing service instance - unlike POST /dids, this endpoint does not resolve the service instance up front, so a nonexistent one surfaces here as a 400 rather than a 404)
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
