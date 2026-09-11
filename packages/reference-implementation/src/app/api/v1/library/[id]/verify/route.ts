import { NextResponse } from 'next/server';
import { TextDecoder } from 'node:util';
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
import { parseRequestBody, ValidationError } from '@/lib/api/validation';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
import { verifyLibraryRecordRequestSchema, type VerifyLibraryRecordRequest } from '@/lib/api/request-schemas/library';
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
  type EnqueueVerification,
  reverifyLibraryRecord,
  SourceEncryptionNotAllowedError,
  VerificationInProgressError,
} from '@/lib/library/reverify-library-record';
import { EncryptionUnavailableError } from '@/lib/library/register-external-credential';
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
 *       external library record. The request body may supply the decryption
 *       key for an unopened external copy. A bodyless request that arrives
 *       while a generation is pending joins that generation. A key-bearing
 *       request in the same situation is rejected with `409
 *       VERIFICATION_IN_PROGRESS`, so its key is never discarded. A
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
 *       `DECRYPTION_REQUIRED` before any fetch when the request is bodyless.
 *       The key-bearing form reads and opens that stored copy in the request.
 *
 *       An external record without a durable copy re-fetches its stored source
 *       in the request, reserving generation N+1 as pending before the fetch
 *       runs. A bodyless concurrent request joins the same attempt. A
 *       key-bearing concurrent request is rejected, because the pending
 *       generation cannot consume its key.
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
 *       already holds a content identity is refused, leaving that identity,
 *       its details and its custody exactly as they were, and storing
 *       nothing for that response in the first place. The code says how far
 *       the bytes got: `SOURCE_NOT_CREDENTIAL` whenever they were read and
 *       yielded no credential, including an envelope a supplied key opened
 *       to something else, and `DECRYPTION_REQUIRED` or `DECRYPTION_FAILED`
 *       when they could not be opened at all. A response
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
 *       The response is the record's current envelope. A key-bearing recovery
 *       that settles before projection can therefore return its settled
 *       `DECRYPTION_FAILED` generation, unless a later generation has already
 *       replaced it.
 *     tags:
 *       - Library
 *     parameters:
 *       - $ref: '#/components/parameters/LibraryRecordId'
 *     requestBody:
 *       required: false
 *       description: |
 *         Omit the request body for ordinary re-verification, or supply a key
 *         for an unopened external copy. `sourceEncryption.decryptionKey` is
 *         the only field this operation reads: unlike the register operation,
 *         it does not accept `sourceEncryption.encryptionMethod`, and a body
 *         carrying that field has it stripped rather than validated, so a
 *         value the register operation would reject is accepted and ignored
 *         here.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyLibraryRecordRequest'
 *     responses:
 *       202:
 *         description: A verification generation was created, an existing pending generation was joined, or the record moved while the request was being prepared. The response contains the record's current envelope, which may already be settled.
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
 *                   capabilities: { deletable: true, annotatable: false, verifiable: true }
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
 *                   verification: { generation: 3, state: complete, requestedAt: '2026-09-07T11:04:00.000Z', completedAt: '2026-09-07T11:04:03.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: pass, status: pass, temporal: pass, schemaConformance: pass }, summary: verified, sourceChanged: false, lastSourceCheckAt: '2026-09-07T11:04:00.000Z' }
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
 *               lateKeyOpenedTheStoredCopy:
 *                 summary: A supplied key opened the record's own unopened durable copy, which was replaced with a receiver-protected copy
 *                 value:
 *                   id: clw0ext3rn4lrecover000007
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
 *                   encrypted: true
 *                   hasKey: true
 *                   verification: { generation: 3, state: pending, requestedAt: '2026-09-09T09:12:00.000Z', checks: { retrieval: pass, decryption: pass, digest: pass, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-09T09:12:00.000Z'
 *               lateDecryptRevealsDuplicate:
 *                 summary: A supplied key opened the stored copy, whose content already belongs to another record
 *                 value:
 *                   id: clw0ext3rn4lrecover000010
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
 *                   encrypted: true
 *                   hasKey: true
 *                   verification: { generation: 3, state: pending, requestedAt: '2026-09-09T09:12:00.000Z', checks: { retrieval: pass, decryption: pass, digest: pass, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: pending }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: [{ code: DUPLICATE_CONTENT, message: 'The credential content matches record clw0ext3rn4lprotect000003.', relatedRecordId: clw0ext3rn4lprotect000003 }]
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-09T09:12:00.000Z'
 *               lateKeyDidNotOpenTheCopy:
 *                 summary: A supplied key did not open the stored copy, which was read and proven intact before the attempt
 *                 value:
 *                   id: clw0ext3rn4lrecover000008
 *                   origin: external
 *                   credential: { name: null, credentialType: null, issuerName: null, issuerDid: null, subjectName: null, subjectId: null, validFrom: null, validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceDigestExample
 *                   resolverUri: null
 *                   issuedAt: null
 *                   encrypted: true
 *                   hasKey: false
 *                   verification: { generation: 3, state: failed, requestedAt: '2026-09-09T09:12:00.000Z', completedAt: '2026-09-09T09:12:01.000Z', checks: { retrieval: pass, decryption: fail, digest: pass, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: failed, failure: { code: DECRYPTION_FAILED, message: "The supplied decryption key did not open this record's durable copy. The copy is kept exactly as it is. Retry with the correct sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.", retryable: true } }
 *                   currencyStatus: unknown
 *                   detailsStatus: EXTRACTION_PENDING
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-08-30T10:20:00.000Z'
 *               storedCopyCouldNotBeRead:
 *                 summary: The reserved durable copy could not be read back, so no check ran at all
 *                 value:
 *                   id: clw0ext3rn4lrecover000009
 *                   origin: external
 *                   credential: { name: null, credentialType: null, issuerName: null, issuerDid: null, subjectName: null, subjectId: null, validFrom: null, validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceDigestExample
 *                   resolverUri: null
 *                   issuedAt: null
 *                   encrypted: true
 *                   hasKey: false
 *                   verification: { generation: 3, state: failed, requestedAt: '2026-09-09T09:12:00.000Z', completedAt: '2026-09-09T09:12:01.000Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: failed, failure: { code: STORED_COPY_UNAVAILABLE, message: 'The durable copy could not be read back from storage (storage returned HTTP 404); this needs an operator to inspect the stored object.', retryable: false } }
 *                   currencyStatus: unknown
 *                   detailsStatus: EXTRACTION_PENDING
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-08-30T10:20:00.000Z'
 *       400:
 *         description: |
 *           `VALIDATION_FAILED` when a non-empty body does not contain a usable
 *           decryption key, or
 *           `SOURCE_ENCRYPTION_NOT_ALLOWED` when a key is supplied for a
 *           native record or an external record whose durable copy is already
 *           protected. That includes a record that was still eligible when
 *           the caller read it and became protected before the reservation
 *           took its lock, so a caller who checked first can still receive
 *           this refusal; it also takes precedence over the `409` below when
 *           both apply at once. Or
 *           `DECRYPTION_REQUIRED` when the request is bodyless and the record
 *           already holds a durable copy of unopened ciphertext. Bodylessness
 *           is the deciding condition: the same record with a key on the
 *           request opens that copy in the request instead. A no-copy
 *           record that turns out to be unopenable ciphertext is not this
 *           case either: it settles as a `202` generation carrying
 *           `DECRYPTION_REQUIRED` or `SOURCE_NOT_CREDENTIAL` instead, because
 *           the fetch had to run before that could be known. A body that
 *           cannot be read is an inherited uncoded `400`; an over-sized body
 *           is an inherited `413 REQUEST_BODY_TOO_LARGE`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidRequestBody:
 *                 summary: The request body did not contain a usable key
 *                 value:
 *                   error: 'sourceEncryption.decryptionKey: Required'
 *                   code: VALIDATION_FAILED
 *               decryptionRequired:
 *                 summary: The record already holds a durable copy of ciphertext this service cannot open
 *                 value:
 *                   error: This service holds no usable key for the record's durable copy. Supply it as sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.
 *                   code: DECRYPTION_REQUIRED
 *               sourceEncryptionNotAllowed:
 *                 summary: The record cannot accept a supplier decryption key
 *                 value:
 *                   error: sourceEncryption may only be supplied for an external record with no protected durable copy yet.
 *                   code: SOURCE_ENCRYPTION_NOT_ALLOWED
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
 *       409:
 *         description: |
 *           A key-bearing request that could not be carried out as sent. Two
 *           states answer it, and the message says which.
 *
 *           A verification generation was already in progress: the caller
 *           waits for it to settle before supplying the key again. An
 *           interrupted key-bearing recovery leaves its own generation
 *           pending, so a caller whose earlier attempt died holds the record
 *           against themselves until the reconciliation sweep settles that
 *           run. The wait is bounded by the deployment's abandonment policy,
 *           at least thirty minutes, and the sweep's settlement then tells
 *           the caller to send the key again.
 *
 *           Or the request lost the generation-index race twice and the
 *           winner had already settled by the time it was read: nothing is in
 *           progress, the supplied key was never used, and it can be sent
 *           again straight away.
 *         headers:
 *           Location:
 *             description: Relative URL of the library record whose generation is in progress.
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               verificationInProgress:
 *                 summary: The key-bearing request cannot join the pending generation
 *                 value:
 *                   error: Verification is already in progress for this record. Wait for it to settle before supplying a key again.
 *                   code: VERIFICATION_IN_PROGRESS
 *               verificationRaceLost:
 *                 summary: The key was never used, so it can be sent again straight away
 *                 value:
 *                   error: Another verification generation was recorded for this record first, so the supplied key was not used. Send it again on POST /api/v1/library/{id}/verify.
 *                   code: VERIFICATION_IN_PROGRESS
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
 *           Every other failure while acquiring or finalising a recovery,
 *           in either acquisition mode (a no-copy recovery that fetches the
 *           supplier source, and a key-bearing recovery that opens the
 *           record's own durable copy), also settles that reservation
 *           `FAILED` and retryable, but still answers this response rather
 *           than `202`, because the
 *           caller needs the coded (or, for an unexpected fault, sanitised)
 *           reason immediately rather than only on the next poll. Which code
 *           that settled generation carries depends on the class of failure,
 *           and the settled code is what the caller reads on the next
 *           `GET /api/v1/library/{id}`: a storage or encryption failure
 *           (encryption unavailable, a store that returned no key, or a
 *           storage service this tenant's configuration could not resolve,
 *           decrypt or validate) settles `STORAGE_FAILED`; a content identity
 *           that collided twice with a concurrent writer, and any unexpected
 *           fault, settle `VERIFICATION_UNAVAILABLE`. That
 *           includes `CREDENTIALS_ENCRYPTION_UNAVAILABLE`, when this service
 *           cannot protect the storage key a durable copy of an opened
 *           credential would need, the same code and cause the register
 *           endpoint uses: a key-bearing recovery that opens a stored copy
 *           reaches the same preflight before it stores the plaintext, so
 *           this response is not confined to the no-copy branch. The one
 *           exception is a
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
    let parsedBody: VerifyLibraryRecordRequest | undefined;
    if (body.byteLength !== 0) {
      try {
        parsedBody = await parseRequestBody(
          { json: async () => JSON.parse(new TextDecoder().decode(body)) },
          verifyLibraryRecordRequestSchema,
        );
      } catch (error) {
        rethrowAsValidationFailed(error);
      }
    }

    if (id.includes('\0')) {
      throw new NotFoundError('No such credential record.', 'NOT_FOUND');
    }

    // The queue starts only once the module has decided a generation will be
    // created, and still outside the transaction that will hold the record's
    // lock. A queue that will not start therefore leaves a not-found, a join
    // and a key refusal answering exactly as they would with a healthy one.
    const enqueueFactory = async (): Promise<EnqueueVerification> => {
      let queue: JobQueue;
      try {
        queue = await startJobQueue();
      } catch (error) {
        throw new JobQueueUnavailableError(error);
      }
      return (sql, job) => queue.enqueueWithin(sql, LIBRARY_VERIFY_JOB, job, VERIFY_JOB_ENQUEUE_OPTIONS);
    };
    const result =
      parsedBody === undefined
        ? await reverifyLibraryRecord(id, tenantId, enqueueFactory)
        : await reverifyLibraryRecord(id, tenantId, enqueueFactory, parsedBody.sourceEncryption.decryptionKey);
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
    if (error instanceof VerificationInProgressError) {
      // Built here rather than through the shared mapper, which sets no
      // headers, and this response carries `Location`. That bypasses the
      // mapper's conflict log line too, so this rejection logs its own,
      // exactly as the duplicate-content 409 on `POST /api/v1/library` does
      // for the same reason. `reason` separates a refusal against a running
      // generation from one against a race this request lost, which the two
      // caller-facing messages also distinguish.
      log.warn(
        { reason: error.reason, generation: error.generation },
        'Key-bearing re-verification refused: the record cannot take this key now',
      );
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409, headers: { Location: `/api/v1/library/${id}` } },
      );
    }
    if (error instanceof SourceEncryptionNotAllowedError) {
      throw new ValidationError(error.message, { code: error.code, cause: error });
    }
    if (isMappedRouteError(error) || isDatabaseError(error)) {
      throw error;
    }
    if (error instanceof DecryptionRequiredError) {
      // Through the shared mapper as a coded validation failure, so this 400
      // carries the same body shape as the route's other coded 400s
      // (`SOURCE_ENCRYPTION_NOT_ALLOWED` above, and the request-schema
      // `VALIDATION_FAILED`) rather than being assembled here.
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
