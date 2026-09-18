import { TextDecoder, TextEncoder } from 'node:util';
import { NextResponse } from 'next/server';
import { ValidationError, parseRequestBody } from '@/lib/api/validation';
import { digestRequestBody, parseIdempotencyKeyHeader, throwIdempotencyClassification } from '@/lib/api/idempotency';
import { readRequestBytes } from '@/lib/api/request-body';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { startJobQueue } from '@/lib/jobs/app-job-queue';
import {
  classifySubmission,
  createCredentialBatch,
  findCredentialBatchSubmission,
} from '@/lib/prisma/repositories/credential-batch.repository';
import { credentialBatchRequestSchema } from '@/lib/api/request-schemas/credential-batch';
import { readMaxBatchItems, readMaxBatchRequestBodyBytes } from '@/lib/config/credential-batch.config';
import { readMaxRequestBodyBytes } from '@/lib/config/request-body-limit.config';
import { buildCredentialBatchExpiredBody } from '@/lib/credentials/credential-batch-error';

const BATCH_STATUS_PATH = '/api/v1/credentials/batches';

function statusUrl(batchId: string): string {
  return `${BATCH_STATUS_PATH}/${encodeURIComponent(batchId)}`;
}

function expiredResponse(batchId: string): Response {
  return NextResponse.json(buildCredentialBatchExpiredBody(batchId), {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function batchValidationMessage(message: string): string {
  return message.replace(/items\.(\d+)(?=\.|$)/g, 'items[$1]');
}

function serialisedJsonByteLength(value: object): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * @swagger
 * /credentials/batches:
 *   post:
 *     operationId: submitCredentialBatch
 *     summary: Queue an ordered batch of credential issuances
 *     description: |
 *       Validates the batch envelope and each ordinary credential request shape,
 *       stores the encrypted item requests and queues worker processing in one
 *       transaction. DID ownership, service resolution, JSON-LD and schema
 *       conformance run per item. The response contains the relative status URL.
 *     tags: [Credentials]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *         description: A printable ASCII key scoped to the authenticated tenant. Reusing it requires the same raw request body.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CredentialBatchRequest'
 *     responses:
 *       202:
 *         description: Batch accepted and queued for worker processing.
 *         headers:
 *           Location:
 *             description: Relative URL of the batch status resource.
 *             schema: { type: string }
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialBatchAcceptedResponse'
 *       400:
 *         description: Invalid Idempotency-Key or batch request shape, including an empty, oversized or invalid items array.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingIdempotencyKey:
 *                 value: { error: 'Idempotency-Key is required', code: IDEMPOTENCY_KEY_REQUIRED }
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       409:
 *         description: The same Idempotency-Key is still being processed. Retry shortly.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               inFlight:
 *                 value: { error: 'A request with this Idempotency-Key is still being processed. Retry shortly.', code: IDEMPOTENCY_KEY_IN_FLIGHT }
 *       410:
 *         description: The retained batch for this Idempotency-Key has expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialBatchExpiredResponse'
 *             examples:
 *               expired:
 *                 value: { error: 'This credential batch has expired. Its credentials were not deleted.', code: BATCH_EXPIRED }
 *       413:
 *         description: The raw batch body exceeds MAX_BATCH_REQUEST_BODY_BYTES.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               batchBodyTooLarge:
 *                 summary: The batch body exceeds the configured batch maximum
 *                 value: { error: 'The request body exceeds MAX_BATCH_REQUEST_BODY_BYTES of 52428800 bytes.', code: REQUEST_BODY_TOO_LARGE }
 *       422:
 *         description: The Idempotency-Key was already used with a different request body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               keyReusedWithDifferentBody:
 *                 value: { error: 'This Idempotency-Key was already used with a different request body.', code: IDEMPOTENCY_KEY_MISMATCH }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId }) => {
  const idempotencyKey = parseIdempotencyKeyHeader(req);
  if (idempotencyKey === undefined) {
    throw new ValidationError('Idempotency-Key is required', { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }

  const requestBytes = await readRequestBytes(req, readMaxBatchRequestBodyBytes(), 'MAX_BATCH_REQUEST_BODY_BYTES');
  const bodyDigest = await digestRequestBody(requestBytes);
  const existing = await findCredentialBatchSubmission(tenantId, idempotencyKey);
  if (existing !== null) {
    const classification = classifySubmission(existing, bodyDigest);
    if (classification.outcome === 'expired') return expiredResponse(classification.batchId);
    if (classification.outcome === 'mismatch') throwIdempotencyClassification('mismatch');
    const replayUrl = statusUrl(classification.batchId);
    return NextResponse.json(
      { batchId: classification.batchId, status: replayUrl },
      { status: 202, headers: { Location: replayUrl } },
    );
  }

  let body;
  try {
    body = await parseRequestBody(
      { json: async () => JSON.parse(new TextDecoder().decode(requestBytes)) },
      credentialBatchRequestSchema,
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError(batchValidationMessage(error.message), error.code ? { code: error.code } : undefined);
    }
    throw error;
  }

  const maxItems = readMaxBatchItems();
  if (body.items.length > maxItems) {
    throw new ValidationError(`items: batch contains ${body.items.length} items but MAX_BATCH_ITEMS is ${maxItems}.`, {
      code: 'BATCH_TOO_LARGE',
    });
  }

  const maxRequestBodyBytes = readMaxRequestBodyBytes();
  const oversizedItemIndex = body.items.findIndex((item) => serialisedJsonByteLength(item) > maxRequestBodyBytes);
  if (oversizedItemIndex !== -1) {
    const itemBytes = serialisedJsonByteLength(body.items[oversizedItemIndex]);
    throw new ValidationError(
      `items[${oversizedItemIndex}]: item is ${itemBytes} bytes but MAX_REQUEST_BODY_BYTES is ${maxRequestBodyBytes}.`,
      { code: 'VALIDATION_FAILED' },
    );
  }

  const queue = await startJobQueue();
  const result = await createCredentialBatch({
    tenantId,
    idempotencyKey,
    bodyDigest,
    items: body.items,
    queue,
  });
  if (result.outcome === 'mismatch') throwIdempotencyClassification('mismatch');
  if (result.outcome === 'expired') return expiredResponse(result.batchId);
  const location = statusUrl(result.batchId);
  return NextResponse.json(
    { batchId: result.batchId, status: location },
    { status: 202, headers: { Location: location } },
  );
});
