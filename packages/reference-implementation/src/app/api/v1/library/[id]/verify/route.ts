import { NextResponse } from 'next/server';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
  UnprocessableError,
  unexpectedErrorMessage,
} from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { readRequestBytes } from '@/lib/api/request-body';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { getLibraryRecordById } from '@/lib/prisma/repositories/library-record.repository';
import {
  CredentialRecordProjectionError,
  toCredentialRecord,
  toNativeCredentialRecord,
  type CredentialRecordResponse,
} from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import {
  DecryptionRequiredError,
  ReverifyBranchNotBuiltError,
  reverifyLibraryRecord,
} from '@/lib/library/reverify-library-record';
import { BODY_MUST_BE_EMPTY_MESSAGE } from '@/lib/library/reverify-messages';
import { LIBRARY_VERIFY_JOB, VERIFY_JOB_ENQUEUE_OPTIONS } from '@/lib/library/verify-generation-job';
import { startJobQueue } from '@/lib/jobs/app-job-queue';
import type { JobQueue } from '@/lib/jobs/types';

const logger = apiLogger.child({ route: '/api/v1/library/[id]/verify' });

/**
 * The cause chain of a failure raised while preparing a re-verification can
 * reach key material, so only the name and message are logged, under `error`
 * rather than `err`. The worker's settlement path takes the same care.
 */
function sanitisedServerError(error: unknown, log: typeof logger, detail: string): Response {
  log.error({ error: safeError(error) }, detail);
  return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
}

/**
 * A job queue that would not start. Distinct so the route answers it with its
 * own log line, and so it cannot be mistaken for a record fault.
 */
class JobQueueUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The job queue could not be started', { cause });
    this.name = 'JobQueueUnavailableError';
  }
}

/** The error classes the shared route mapper answers with a caller-facing status and its own message. */
function isMappedRouteError(error: unknown): boolean {
  return (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof UnprocessableError ||
    error instanceof NotFoundError ||
    error instanceof RequestBodyUnreadableError ||
    error instanceof PayloadTooLargeError
  );
}

function responseFor(view: Awaited<ReturnType<typeof getLibraryRecordById>>): CredentialRecordResponse {
  if (view === null) throw new NotFoundError('No such credential record.', 'NOT_FOUND');
  return view.origin === LibraryRecordOrigin.NATIVE ? toNativeCredentialRecord(view) : toCredentialRecord(view);
}

/**
 * @swagger
 * /library/{id}/verify:
 *   post:
 *     operationId: reverifyLibraryRecord
 *     summary: Re-verify one library record
 *     description: |
 *       Starts a new verification generation for a tenant-owned native or
 *       external library record. The request body must be empty. A request
 *       that arrives while a generation is pending joins that generation. A
 *       request whose record changed while it was being prepared starts no new
 *       generation and returns the record's current one, which may already be
 *       settled. The response is the current keyless record and its newest
 *       verification envelope. Re-poll `GET /api/v1/library/{id}` to see the
 *       generation settle.
 *
 *       One case is not observable on that poll. When the service cannot
 *       unlock the key it holds for the durable copy, the generation settles
 *       as `STORED_COPY_UNAVAILABLE` with `retryable: true`, and the detail
 *       route returns a sanitised `500` until an operator restores access to
 *       the encryption key. That gap is tracked by
 *       [uncefact/tests-untp#769](https://github.com/uncefact/tests-untp/issues/769).
 *
 *       Native records read their stored artefact on the worker. An external
 *       record with a protected copy re-verifies that pinned copy and checks
 *       the supplier source for freshness without replacing the copy. An
 *       external record holding unopened ciphertext is rejected with
 *       `DECRYPTION_REQUIRED`; the key-bearing form is tracked by
 *       [uncefact/tests-untp#958](https://github.com/uncefact/tests-untp/issues/958).
 *       External records without a durable copy are not supported by this
 *       release and return a sanitised server error until the recovery branch
 *       lands with
 *       [uncefact/tests-untp#956](https://github.com/uncefact/tests-untp/issues/956).
 *
 *       `202` means the generation was created, joined or superseded. It may
 *       already be failed when the response is read, for example when a worker
 *       has settled a stored-copy failure between the write and this response.
 *     tags:
 *       - Library
 *     parameters:
 *       - $ref: '#/components/parameters/LibraryRecordId'
 *     requestBody:
 *       required: false
 *       description: Omit the request body. Any body bytes are rejected until the key-bearing form is available.
 *       content:
 *         application/octet-stream:
 *           schema:
 *             type: string
 *             maxLength: 0
 *     responses:
 *       202:
 *         description: A verification generation was created, an existing pending generation was joined, or the record moved while the request was being prepared.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialRecord'
 *             examples:
 *               externalGenerationCreated:
 *                 summary: A new generation was created for an external record with a protected copy
 *                 value:
 *                   id: clw0ext3rn4lprotect000003
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceDigestExample
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 3, state: pending, requestedAt: '2026-09-07T11:04:00.000Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-08-30T10:20:00.000Z'
 *               joinedPendingGeneration:
 *                 summary: A generation was already pending, so this request joined it and started no second job
 *                 value:
 *                   id: clw0ext3rn4lprotect000003
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceDigestExample
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 3, state: pending, requestedAt: '2026-09-07T11:03:58.000Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-08-30T10:20:00.000Z'
 *               nativeSecondGeneration:
 *                 summary: A native record's first executed generation is 2, and its acquisition checks stay not_run
 *                 value:
 *                   id: clw0n4t1v3encrypted000001
 *                   origin: native
 *                   credential: { name: Battery Pack DPP, credentialType: DPP, issuerName: Acme Battery Co, issuerDid: 'did:web:acme.example', subjectName: Battery Pack Model X, subjectId: 'https://acme.example/products/battery-x', validFrom: '2026-07-15T09:00:00.000Z', validUntil: '2029-07-15T09:00:00.000Z' }
 *                   annotations: null
 *                   organisationId: clw0org4n1s4t10n00000001
 *                   facilityId: null
 *                   productId: clw0pr0duct000000000001a
 *                   sourceUrl: null
 *                   sourceDigest: null
 *                   resolverUri: null
 *                   issuedAt: '2026-07-15T09:00:00.000Z'
 *                   encrypted: true
 *                   hasKey: true
 *                   verification: { generation: 2, state: pending, requestedAt: '2026-09-07T11:04:00.000Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: false, annotatable: false, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-07-15T09:00:00.000Z'
 *                   updatedAt: '2026-07-15T09:00:00.000Z'
 *               settledWithUnchangedSource:
 *                 summary: The generation settled before the response was read, and the supplier source matched the pinned copy
 *                 value:
 *                   id: clw0ext3rn4lprotect000003
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceDigestExample
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 3, state: complete, requestedAt: '2026-09-07T11:04:00.000Z', completedAt: '2026-09-07T11:04:03.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: pass, status: pass, temporal: pass, schemaConformance: not_run }, summary: verified, sourceChanged: false, lastSourceCheckAt: '2026-09-07T11:04:00.000Z' }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-08-30T10:20:00.000Z'
 *       400:
 *         description: |
 *           `VALIDATION_FAILED` when any request-body bytes are present, or
 *           `DECRYPTION_REQUIRED` when the external record only has unopened
 *           ciphertext and no usable key is held. A body that cannot be read
 *           is an inherited uncoded `400`; an over-sized body is an inherited
 *           `413 REQUEST_BODY_TOO_LARGE`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               bodyPresent:
 *                 summary: The request carried body bytes
 *                 value:
 *                   error: The re-verification request body must be empty. Supplying a decryption key is not supported on this endpoint yet.
 *                   code: VALIDATION_FAILED
 *               decryptionRequired:
 *                 summary: The record holds ciphertext this service cannot open
 *                 value:
 *                   error: This service holds no usable key for the record's durable copy. Re-verification with a caller-supplied key is not supported yet.
 *                   code: DECRYPTION_REQUIRED
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: No such credential record in the caller's tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       413:
 *         $ref: '#/components/responses/PayloadTooLargeResponse'
 *       500:
 *         description: |
 *           The record could not be read, projected or interpreted, the job
 *           queue could not be started, or the record's re-verification branch
 *           is not built in this release. The response body carries the
 *           request correlation id and no detail.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;
  const log = logger.child({ recordId: id, tenantId });

  try {
    const body = await readRequestBytes(req);
    if (body.byteLength !== 0) {
      throw new ValidationError(BODY_MUST_BE_EMPTY_MESSAGE, { code: 'VALIDATION_FAILED' });
    }

    if (id.includes('\0')) {
      throw new NotFoundError('No such credential record.', 'NOT_FOUND');
    }

    // The queue starts only once the module has decided a generation will be
    // created, and still outside the transaction that will hold the record's
    // lock. A queue that will not start therefore leaves a not-found, a join
    // and a key refusal answering exactly as they would with a healthy one.
    const result = await reverifyLibraryRecord(id, tenantId, async () => {
      let queue: JobQueue;
      try {
        queue = await startJobQueue();
      } catch (error) {
        throw new JobQueueUnavailableError(error);
      }
      return (sql, job) => queue.enqueueWithin(sql, LIBRARY_VERIFY_JOB, job, VERIFY_JOB_ENQUEUE_OPTIONS);
    });
    const response = await currentResponse(id, tenantId);
    log.info(
      {
        outcome: result.outcome,
        generation: response.verification.generation,
        state: response.verification.state,
        failureCode: response.verification.state === 'failed' ? response.verification.failure.code : null,
      },
      'Re-verification request accepted',
    );
    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    if (isMappedRouteError(error) || isDatabaseError(error)) {
      throw error;
    }
    if (error instanceof DecryptionRequiredError) {
      // Through the shared mapper as a coded validation failure, so this 400
      // and the body-must-be-empty 400 cannot drift into two shapes.
      throw new ValidationError(error.message, { code: error.code, cause: error });
    }
    if (error instanceof JobQueueUnavailableError) {
      log.error(
        { error: safeError(error), cause: safeError(error.cause) },
        'The job queue could not be started for re-verification',
      );
      return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
    }
    if (error instanceof ReverifyBranchNotBuiltError) {
      return sanitisedServerError(error, log, 'The external re-verification branch is not built');
    }
    if (error instanceof LibraryRecordShapeError) {
      return sanitisedServerError(error, log, 'The library record has a shape the write paths never produce');
    }
    if (error instanceof CredentialRecordProjectionError) {
      return sanitisedServerError(error, log, 'The library record could not be projected');
    }
    return sanitisedServerError(error, log, 'Re-verification failed');
  }
});

async function currentResponse(id: string, tenantId: string): Promise<CredentialRecordResponse> {
  return responseFor(await getLibraryRecordById(id, tenantId));
}
