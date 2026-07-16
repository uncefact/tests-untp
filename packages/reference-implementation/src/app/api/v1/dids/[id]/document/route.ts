import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDidById } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/dids/[id]/document' });

/**
 * @swagger
 * /dids/{id}/document:
 *   get:
 *     summary: Get DID Document
 *     description: Retrieves the DID Document for a specific DID. The DID Document contains the public keys, authentication methods, and service endpoints associated with the DID.
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
 *         description: DID Document retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DidDocument'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
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
 *         description: DID or service instance not found
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
 *       502:
 *         description: Upstream DID document fetch failed (DID_DOCUMENT_FETCH_FAILED) - the resolved VC service could not resolve the DID document
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ didId: id }, 'Looking up DID for document retrieval');
  const did = await getDidById(id, tenantId);
  if (!did) {
    throw new NotFoundError('DID not found');
  }

  logger.info({ didId: id, did: did.did }, 'Resolving DID service');
  const { service: didService } = await resolveDidService(tenantId, did.serviceInstanceId ?? undefined);

  logger.info({ didId: id, did: did.did }, 'Fetching DID document from provider');
  const document = await didService.getDocument(did.did);

  logger.info({ didId: id }, 'DID document retrieved');
  return NextResponse.json(document);
});
