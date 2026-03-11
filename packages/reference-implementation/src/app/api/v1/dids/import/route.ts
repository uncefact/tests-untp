import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, validateEnum } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDid } from '@/lib/prisma/repositories';
import { DidMethod } from '@uncefact/untp-ri-services';
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: {
    did?: string;
    method?: string;
    keyId?: string;
    name?: string;
    description?: string;
    serviceInstanceId?: string;
  };

  logger.info('Parsing request body');
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ did: body.did, method: body.method }, 'Validating import parameters');
  if (!isNonEmptyString(body.did)) {
    throw new ValidationError('did is required');
  }
  if (!isNonEmptyString(body.keyId)) {
    throw new ValidationError('keyId is required');
  }
  if (!isNonEmptyString(body.serviceInstanceId)) {
    throw new ValidationError('serviceInstanceId is required');
  }

  const method = validateEnum(body.method, Object.values(DidMethod), 'method');
  if (!method) {
    throw new ValidationError('method is required');
  }

  logger.info({ did: body.did, method }, 'Saving imported DID record');
  const record = await createDid({
    tenantId,
    did: body.did,
    type: 'SELF_MANAGED',
    method,
    keyId: body.keyId,
    name: body.name ?? body.did,
    description: body.description,
    status: 'UNVERIFIED',
    serviceInstanceId: body.serviceInstanceId,
  });

  logger.info({ didId: record.id, did: record.did }, 'DID imported');
  return NextResponse.json(record, { status: 201 });
});
