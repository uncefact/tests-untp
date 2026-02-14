import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { NotFoundError, ServiceRegistryError, errorMessage } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDidById } from '@/lib/prisma/repositories';
import { createLogger } from '@uncefact/untp-ri-services';

const logger = createLogger().child({ module: 'api:dids:document' });

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
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 document:
 *                   $ref: '#/components/schemas/DidDocument'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
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
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  try {
    const did = await getDidById(id, tenantId);
    if (!did) {
      throw new NotFoundError('DID not found');
    }

    const { service: didService } = await resolveDidService(tenantId, did.serviceInstanceId ?? undefined);
    const document = await didService.getDocument(did.did);

    return NextResponse.json({ ok: true, document });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ServiceRegistryError) {
      const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
      return NextResponse.json({ ok: false, error: e.message }, { status });
    }
    logger.error({ error: e, didId: id }, 'Unexpected error fetching DID document');
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
