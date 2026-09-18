import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getCredentialBatchById } from '@/lib/prisma/repositories/credential-batch.repository';
import { buildCredentialBatchExpiredBody } from '@/lib/credentials/credential-batch-error';
import { projectCredentialBatch } from '@/lib/credentials/credential-batch-projection';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/**
 * @swagger
 * /credentials/batches/{id}:
 *   get:
 *     operationId: getCredentialBatch
 *     summary: Read credential batch progress and item outcomes
 *     description: |
 *       Reads the durable batch projection for the authenticated tenant. A
 *       batch runs to completion because cancellation is not supported. A
 *       `NEEDS_ATTENTION` response is a deliberate hold: no item remains
 *       queued, but one or more external issuance outcomes are unknown and
 *       require operator resolution before the batch can become completed. A
 *       settled batch is retained until BATCH_RETENTION_DAYS after settlement;
 *       the expired tombstone keeps the idempotency key and counts but removes
 *       encrypted item requests and outcomes. Ordering is promised within the
 *       batch only.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       200:
 *         description: Current batch state and per-item results.
 *         headers:
 *           Cache-Control:
 *             description: This progress response is never cached.
 *             schema:
 *               type: string
 *               enum: [no-store]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialBatchStatus'
 *       404:
 *         description: The batch is unknown or belongs to another tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               notFound:
 *                 summary: The tenant-owned batch does not exist
 *                 value:
 *                   error: Credential batch not found.
 *       410:
 *         description: The batch's retained item data has expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialBatchExpiredResponse'
 *             examples:
 *               expired:
 *                 summary: The retained batch data has expired
 *                 value:
 *                   error: This credential batch has expired. Its credentials were not deleted.
 *                   code: BATCH_EXPIRED
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  const batch = await getCredentialBatchById(id, tenantId);
  if (batch === null) throw new NotFoundError('Credential batch not found.');

  const projection = projectCredentialBatch(batch);
  if (batch.state === 'EXPIRED') {
    return NextResponse.json(
      { ...projection, ...buildCredentialBatchExpiredBody() },
      { status: 410, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(projection, { status: 200, headers: NO_STORE_HEADERS });
});
