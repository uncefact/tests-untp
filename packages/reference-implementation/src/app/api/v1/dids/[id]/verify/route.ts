import { NotFoundError } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { ValidationError } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDidById, updateDidStatus } from '@/lib/prisma/repositories';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { DidStatus } from '@uncefact/untp-ri-services';
import { NextResponse } from 'next/server';

const logger = apiLogger.child({ route: '/api/v1/dids/[id]/verify' });

/**
 * @swagger
 * /dids/{id}/verify:
 *   post:
 *     summary: Verify a DID
 *     description: |
 *       Verifies that a DID can be resolved and updates its status accordingly.
 *       If verification succeeds, the DID status is set to VERIFIED.
 *       If verification fails, the DID status is set to VERIFICATION_FAILED.
 *       Status changes only when verification runs to completion and returns a result; a pre-verification
 *       failure (the DEFAULT-type guard, or a DID whose format or method cannot be parsed) leaves the DID's
 *       current status unchanged.
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
 *                 verification:
 *                   $ref: '#/components/schemas/VerificationResult'
 *                 did:
 *                   $ref: '#/components/schemas/Did'
 *       400:
 *         description: |
 *           Either of:
 *           - System default DIDs cannot be verified through this endpoint.
 *           - DID_PARSE_FAILED or DID_METHOD_NOT_SUPPORTED: the stored DID string does not parse as `did:method:identifier`, or names a method this deployment does not support. Import (POST /dids/import) now rejects both at the boundary, so this check catches records stored before that validation was in place, and any record whose method stopped being supported after it was stored.
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
 */
export const POST = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ didId: id }, 'Looking up DID for verification');
  const did = await getDidById(id, tenantId);
  if (!did) {
    throw new NotFoundError('DID not found');
  }

  if (did.type === 'DEFAULT') {
    throw new ValidationError('System default DIDs cannot be verified through this endpoint');
  }

  logger.info({ didId: id, did: did.did }, 'Resolving DID service for verification');
  const { service: didService } = await resolveDidService(tenantId, did.serviceInstanceId ?? undefined);

  logger.info({ didId: id, did: did.did }, 'Verifying DID resolution');
  const verification = await didService.verify(did.did);

  const newStatus = verification.verified ? DidStatus.VERIFIED : DidStatus.VERIFICATION_FAILED;
  logger.info({ didId: id, verified: verification.verified, newStatus }, 'Updating DID status');
  const updatedDid = await updateDidStatus(id, tenantId, newStatus);

  logger.info({ didId: id, verified: verification.verified }, 'DID verification complete');
  return NextResponse.json({ verification, did: updatedDid });
});
