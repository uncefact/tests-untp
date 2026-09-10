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
import { DecryptionRequiredError, reverifyLibraryRecord } from '@/lib/library/reverify-library-record';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
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
 *       When the service cannot unlock the key it holds for the durable copy,
 *       the generation settles as `STORED_COPY_UNAVAILABLE` with
 *       `retryable: true`, and the detail poll reports that state on the
 *       record: `200` with `hasKey: true`, a null `decryptionKey` and one
 *       `DECRYPTION_KEY_UNAVAILABLE` warning, until an operator restores
 *       access to the encryption key.
 *
 *       Native records read their stored artefact on the worker. An external
 *       record with a protected copy re-verifies that pinned copy and checks
 *       the supplier source for freshness without replacing the copy. An
 *       external record already holding unopened ciphertext (a durable copy
 *       exists and no usable key is held) is rejected with
 *       `DECRYPTION_REQUIRED` before any fetch; the key-bearing form is
 *       tracked by [uncefact/tests-untp#958](https://github.com/uncefact/tests-untp/issues/958).
 *
 *       An external record without a durable copy always re-fetches its
 *       stored source in the request, reserving generation N+1 as pending
 *       before the fetch runs so a concurrent request joins the same attempt.
 *       What the fetch returns decides the outcome, not the record's own
 *       stale state: a response that opens the credential the record already
 *       holds, or a different one, replaces identity and details and, when
 *       storage succeeds, custody too, then queues verification, promoting an
 *       advisory pointer if the previous identity had one; a storage failure
 *       instead settles `STORAGE_FAILED`, retryable, with custody left empty
 *       and identity and details still written, except a payload the
 *       storage service refuses outright, which settles the same code with
 *       `retryable: false`, because the same request will not succeed until
 *       an operator changes the service's upload rules. A response that does not
 *       open a credential (an envelope or an unrelated body) on a record that
 *       already holds a content identity is refused with `DECRYPTION_REQUIRED`
 *       (an envelope) or `SOURCE_NOT_CREDENTIAL` (any other body), leaving
 *       that identity, its details and its custody exactly as they were, and
 *       storing nothing for that response in the first place. A response
 *       that does not open a credential on a record with no identity to
 *       protect is stored exactly as a fresh registration would store it: an
 *       unopened envelope keeps its ciphertext, so a later bodyless call then
 *       meets the already-holds-a-copy `DECRYPTION_REQUIRED` case above; any
 *       other body settles like registration's own non-credential row
 *       instead and is not ciphertext, so a later bodyless call takes the
 *       protected-copy branch above rather than that `400`. When the
 *       reservation's own identity snapshot held an identity, storing a
 *       non-opening response was skipped in the request as pointless work;
 *       if that identity has since been cleared by the time finalisation
 *       reads the row under its own lock, the prepared failure was never
 *       earned and is not the one settled: this instead settles `FAILED`
 *       `VERIFICATION_UNAVAILABLE`, retryable, naming the identity change,
 *       with the freshness pair still stamped from the fetch that did run,
 *       and touches no custody, identity or details column. Finalisation
 *       locks every parent the identity reconciliation touches and, when
 *       concurrent recoveries of the same new content keep moving that lock
 *       set among themselves, restarts up to a bounded number of times; a
 *       set that still has not settled once that bound is spent settles the
 *       reservation `FAILED` `VERIFICATION_UNAVAILABLE`, retryable, naming a
 *       moving identity set, answered here the same way once that settle
 *       write itself commits (see the `500` response for the unconfirmed
 *       case).
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
 *               recoveredWithoutDurableCopy:
 *                 summary: A missing durable copy was fetched again and the new copy was queued for verification
 *                 value:
 *                   id: clw0ext3rn4lrecover000004
 *                   origin: external
 *                   credential: { name: Recovered DPP, credentialType: DPP, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Battery Pack, subjectId: 'https://supplier.example/products/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recovered DPP from Supplier Ltd, declaredCredentialType: DPP, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dpp-42'
 *                   sourceDigest: zQmRecoveredSourceDigest
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 2, state: pending, requestedAt: '2026-09-07T11:04:00.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-07T11:04:00.000Z'
 *               recoveredDuplicateContent:
 *                 summary: A re-fetched credential already belongs to another record
 *                 value:
 *                   id: clw0ext3rn4lrecover000005
 *                   origin: external
 *                   credential: { name: Recovered DPP, credentialType: DPP, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Battery Pack, subjectId: 'https://supplier.example/products/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recovered DPP from Supplier Ltd, declaredCredentialType: DPP, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dpp-42'
 *                   sourceDigest: zQmRecoveredSourceDigest
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 2, state: pending, requestedAt: '2026-09-07T11:04:00.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: [{ code: DUPLICATE_CONTENT, message: 'The credential content matches record clw0ext3rn4lprotect000003.', relatedRecordId: clw0ext3rn4lprotect000003 }]
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-07T11:04:00.000Z'
 *               recoveredRejectedReplacement:
 *                 summary: A re-fetch did not return the credential this record already holds, so its identity, details and custody were left unchanged
 *                 value:
 *                   id: clw0ext3rn4lrecover000006
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
 *                   hasKey: false
 *                   verification: { generation: 3, state: failed, requestedAt: '2026-09-07T11:04:00.000Z', completedAt: '2026-09-07T11:04:01.000Z', checks: { retrieval: pass, decryption: not_run, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: failed, failure: { code: SOURCE_NOT_CREDENTIAL, message: 'The re-fetched source did not return the credential this record already holds. Its content identity and details have been preserved unchanged; the fetched body was discarded rather than replacing them.', retryable: true }, sourceChanged: true, lastSourceCheckAt: '2026-09-07T11:04:00.000Z' }
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
 *           `DECRYPTION_REQUIRED` when the record already holds a durable
 *           copy of unopened ciphertext and no usable key is held. A no-copy
 *           record that turns out to be unopenable ciphertext is not this
 *           case: it settles as a `202` generation carrying
 *           `DECRYPTION_REQUIRED` or `SOURCE_NOT_CREDENTIAL` instead, because
 *           the fetch had to run before that could be known. A body that
 *           cannot be read is an inherited uncoded `400`; an over-sized body
 *           is an inherited `413 REQUEST_BODY_TOO_LARGE`.
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
 *                 summary: The record already holds a durable copy of ciphertext this service cannot open
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
 *           The record could not be read, projected or interpreted, or the
 *           job queue could not be started. A queue that will not start
 *           *before* any no-copy reservation exists (the native and
 *           protected-copy branches enqueue before locking anything)
 *           answers this response with no generation created and nothing
 *           fetched or stored. A queue that will not start *after* a
 *           no-copy reservation already exists instead settles that
 *           reservation `FAILED` and answers `202` with it (see the `202`
 *           cases above), because the reservation itself already exists,
 *           unless the settle write itself also fails, a transient database
 *           fault separate from the queue failure that triggered it, in
 *           which case the reservation stays `PENDING` and this response is
 *           answered instead, since a `202` would otherwise promise a
 *           settlement that never actually committed; the reconciliation
 *           sweep remains the eventual backstop for that reservation.
 *           Every other failure while fetching or finalising a no-copy
 *           recovery (including `CREDENTIALS_ENCRYPTION_UNAVAILABLE`, when
 *           this service cannot protect the storage key a durable copy of
 *           an opened credential would need, the same code and cause the
 *           register endpoint uses) settles that reservation `FAILED` too,
 *           but still answers this response rather than `202`, because the
 *           caller needs the coded (or, for an unexpected fault, sanitised)
 *           reason immediately rather than only on the next poll, except a
 *           lock-discovery exhaustion (concurrent recoveries of the same new
 *           content moving the identity set past finalisation's bounded
 *           restart), which answers `202` with that settled generation
 *           instead, exactly like the queue-unavailable case above, once its
 *           own settle write commits; an unconfirmed settle still answers
 *           this response. Either way, the reservation is settled and not
 *           left `PENDING`, so a later re-verify reserves a fresh
 *           generation. Any other server
 *           error's response body carries the request correlation id and no
 *           detail.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               encryptionUnavailable:
 *                 value:
 *                   error: Credential storage encryption is not available.
 *                   code: CREDENTIALS_ENCRYPTION_UNAVAILABLE
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
    if (error instanceof EncryptionUnavailableError) {
      // A no-copy recovery that opens a credential can reach the same D10
      // preflight registration does, and must answer it the same coded way
      // rather than the generic sanitised 500 below. By the time this is
      // caught, the reservation has already been settled `FAILED`
      // (`STORAGE_FAILED`), so a generation was in fact created and
      // recorded; this coded 500 exists only so the caller does not have to
      // poll to learn the reason immediately.
      log.error(
        { error: safeError(error), cause: safeError(error.cause) },
        'Encryption is not available; the recovery generation was settled failed',
      );
      return NextResponse.json({ error: error.message, code: 'CREDENTIALS_ENCRYPTION_UNAVAILABLE' }, { status: 500 });
    }
    if (error instanceof JobQueueUnavailableError) {
      log.error(
        { error: safeError(error), cause: safeError(error.cause) },
        'The job queue could not be started for re-verification',
      );
      return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
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
