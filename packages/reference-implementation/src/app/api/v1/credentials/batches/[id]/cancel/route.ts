import { NextResponse } from 'next/server';
import { ConflictError, NotFoundError, unexpectedErrorMessage } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { readRequestBytes } from '@/lib/api/request-body';
import { apiLogger } from '@/lib/api/logger';
import { containsNulByte } from '@/lib/api/route-id';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { prisma } from '@/lib/prisma/prisma';
import { cancelCredentialBatch } from '@/lib/prisma/repositories/credential-batch.repository';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';
import {
  credentialBatchExpiredResponse,
  CREDENTIAL_BATCH_BODY_NOT_ALLOWED_MESSAGE,
  CREDENTIAL_BATCH_CANCEL_ACCEPTED_MESSAGE,
  CREDENTIAL_BATCH_NOT_CANCELLABLE_MESSAGE,
  CredentialBatchCounterDriftError,
} from '@/lib/credentials/credential-batch-error';
import { projectCredentialBatch } from '@/lib/credentials/credential-batch-projection';

const logger = apiLogger.child({ route: '/api/v1/credentials/batches/[id]/cancel' });

/**
 * @swagger
 * /credentials/batches/{id}/cancel:
 *   post:
 *     operationId: cancelCredentialBatch
 *     summary: Cancel the queued items in a credential batch
 *     description: |
 *       Send no request body, including no empty JSON object. Cancels every queued
 *       item atomically for the authenticated tenant (ADR-060). An item already
 *       processing finishes its current attempt and may still be issued. Nothing
 *       is revoked. The projection includes counts.cancelled and cancelRequestedAt.
 *       Repeating the request while cancellation is requested and the batch is
 *       still QUEUED or RUNNING returns 202 unchanged. COMPLETED, NEEDS_ATTENTION
 *       and settled CANCELLED batches return 409. Poll the status resource after
 *       a lost response to see whether cancellation was accepted.
 *     tags: [Credentials]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: Cancellation accepted, including an unchanged active repeat.
 *         headers:
 *           Cache-Control:
 *             description: This progress response is never cached.
 *             schema: { type: string, enum: [no-store] }
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialBatchCancelAcceptedResponse'
 *             examples:
 *               processing:
 *                 summary: Four items cancelled while the current attempt finishes
 *                 value:
 *                   id: batch-1
 *                   state: RUNNING
 *                   counts: { total: 5, queued: 0, processing: 1, issued: 0, failed: 0, unknown: 0, cancelled: 4 }
 *                   createdAt: '2026-09-18T00:00:00.000Z'
 *                   settledAt: null
 *                   cancelRequestedAt: '2026-09-18T00:01:00.000Z'
 *                   items:
 *                     - { index: 0, state: PROCESSING }
 *                     - { index: 1, state: CANCELLED }
 *                     - { index: 2, state: CANCELLED }
 *                     - { index: 3, state: CANCELLED }
 *                     - { index: 4, state: CANCELLED }
 *                   message: Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.
 *       400:
 *         description: A non-empty request body was supplied, or the request body could not be read.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               bodyNotAllowed:
 *                 value: { error: 'Send this request without a body.' }
 *               unreadableBody:
 *                 value: { error: 'Could not read the request body' }
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: The batch is unknown or belongs to another tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               notFound:
 *                 value: { error: 'Credential batch not found.' }
 *       409:
 *         description: The batch is COMPLETED, NEEDS_ATTENTION or CANCELLED.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               notCancellable:
 *                 value: { error: 'This credential batch cannot be cancelled because it has already settled.', code: 'BATCH_NOT_CANCELLABLE' }
 *       410:
 *         description: The retained item data has expired. The response includes the tombstone projection.
 *         headers:
 *           Cache-Control:
 *             description: This expired response is never cached.
 *             schema: { type: string, enum: [no-store] }
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialBatchExpiredResponse'
 *             examples:
 *               expired:
 *                 value:
 *                   id: batch-1
 *                   state: EXPIRED
 *                   counts: { total: 5, queued: 0, processing: 0, issued: 1, failed: 0, unknown: 0, cancelled: 4 }
 *                   createdAt: '2026-09-18T00:00:00.000Z'
 *                   settledAt: '2026-09-18T00:02:00.000Z'
 *                   cancelRequestedAt: '2026-09-18T00:01:00.000Z'
 *                   items: []
 *                   error: This credential batch has expired. Its credentials were not deleted.
 *                   code: BATCH_EXPIRED
 *       413:
 *         $ref: '#/components/responses/PayloadTooLargeResponse'
 *       500:
 *         description: Server error. A cancellation counter-drift failure returns the sanitised message with the request correlation id shown below. Other server errors follow the shared route error handler.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               counterDrift:
 *                 value: { error: 'An unexpected error has occurred. If the issue persists, please contact support and quote correlation id "request-correlation-id".' }
 */
export const POST = withTenantAuth(async (req, { tenantId, params }) => {
  const bytes = await readRequestBytes(req);
  if (bytes.byteLength !== 0) throw new ValidationError(CREDENTIAL_BATCH_BODY_NOT_ALLOWED_MESSAGE);

  const { id } = await params;
  if (containsNulByte(id)) throw new NotFoundError('Credential batch not found.');
  let result;
  try {
    result = await prisma.$transaction((tx) => cancelCredentialBatch(tx, { batchId: id, tenantId }), {
      maxWait: 5_000,
      timeout: 15_000,
    });
  } catch (error) {
    if (!(error instanceof CredentialBatchCounterDriftError)) throw error;
    const correlationId = getRequestContext()?.correlationId;
    logger.error(
      {
        correlationId,
        batchCorrelationId: error.batchCorrelationId,
        batchId: error.batchId,
        tenantId: error.tenantId,
        cancelledRows: error.cancelledRows,
        queuedCount: error.queuedCount,
      },
      'Credential batch cancellation counter drift',
    );
    return NextResponse.json({ error: unexpectedErrorMessage(correlationId) }, { status: 500 });
  }
  if (result.outcome === 'missing') throw new NotFoundError('Credential batch not found.');
  if (result.outcome === 'not-cancellable') {
    throw new ConflictError(CREDENTIAL_BATCH_NOT_CANCELLABLE_MESSAGE, 'BATCH_NOT_CANCELLABLE');
  }

  if (result.outcome === 'applied') {
    logger.warn(
      {
        action: 'cancel',
        tenantId,
        batchId: id,
        batchCorrelationId: result.batch.correlationId,
        cancelledCount: result.batch.cancelledCount,
        outcome: result.outcome,
        at: new Date().toISOString(),
      },
      'Credential batch operator audit',
    );
  }

  const projection = projectCredentialBatch(result.batch);
  if (result.outcome === 'expired') {
    const expired = credentialBatchExpiredResponse(projection);
    return NextResponse.json(expired.body, expired.init);
  }
  return NextResponse.json(
    {
      ...projection,
      message: CREDENTIAL_BATCH_CANCEL_ACCEPTED_MESSAGE,
    },
    { status: 202, headers: { 'Cache-Control': 'no-store' } },
  );
});
