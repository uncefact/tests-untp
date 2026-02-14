import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { NotFoundError, ServiceRegistryError, errorMessage } from '@/lib/api/errors';
import { DidStatus } from '@uncefact/untp-ri-services';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDidById, updateDidStatus } from '@/lib/prisma/repositories';

/**
 * @swagger
 * /dids/{id}/verify:
 *   post:
 *     summary: Verify a DID
 *     description: |
 *       Verifies ownership of a DID and updates its status accordingly.
 *       If verification succeeds, the DID status is set to VERIFIED.
 *       If verification fails, the status remains UNVERIFIED.
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the DID to verify
 *     responses:
 *       200:
 *         description: Verification completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 verification:
 *                   $ref: '#/components/schemas/VerificationResult'
 *                 did:
 *                   $ref: '#/components/schemas/Did'
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
const logger = createLogger().child({ module: 'api:dids:verify' });
export const POST = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  try {
    const did = await getDidById(id, tenantId);
    if (!did) {
      throw new NotFoundError('DID not found');
    }

    const { service: didService } = await resolveDidService(tenantId, did.serviceInstanceId ?? undefined);
    const verification = await didService.verify(did.did);

    const newStatus = verification.verified ? DidStatus.VERIFIED : DidStatus.UNVERIFIED;
    const updatedDid = await updateDidStatus(id, tenantId, newStatus);

    return NextResponse.json({ ok: true, verification, did: updatedDid });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ServiceRegistryError) {
      const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
      return NextResponse.json({ ok: false, error: e.message }, { status });
    }
    logger.error({ error: e, didId: id }, 'Unexpected error verifying DID');
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
