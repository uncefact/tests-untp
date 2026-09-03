import { TextDecoder } from 'node:util';
import { NextResponse } from 'next/server';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';
import { apiLogger } from '@/lib/api/logger';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
  UnprocessableError,
  unexpectedErrorMessage,
} from '@/lib/api/errors';
import { assertHttpUrl, parseRequestBody, ValidationError } from '@/lib/api/validation';
import { readRequestBytes } from '@/lib/api/request-body';
import {
  digestRequestBody,
  IDEMPOTENCY_KEY_HELD_ELSEWHERE_MESSAGE,
  IDEMPOTENCY_KEY_RECORD_DELETED_MESSAGE,
  parseIdempotencyKeyHeader,
  throwIdempotencyClassification,
} from '@/lib/api/idempotency';
import {
  registerExternalCredentialRequestSchema,
  type RegisterExternalCredentialRequest,
} from '@/lib/api/request-schemas/library';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { IdempotencyOperation } from '@/lib/prisma/generated';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  findIdempotencyKey,
  IdempotencyClaimLostError,
  IdempotencyClaimOperationMismatchError,
  releaseIdempotencyKey,
} from '@/lib/prisma/repositories/idempotency-key.repository';
import {
  getExternalCredentialById,
  type ExternalCredentialRecord,
} from '@/lib/prisma/repositories/external-credential.repository';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import {
  CredentialRecordProjectionError,
  toCredentialRecord,
  type CredentialRecordResponse,
} from '@/lib/library/credential-record-projection';
import {
  defaultRegisterDependencies,
  EncryptionUnavailableError,
  registerExternalCredential,
  SourceRejectedError,
  StorageKeyMissingError,
} from '@/lib/library/register-external-credential';
import { LIBRARY_VERIFY_JOB, VERIFY_JOB_ENQUEUE_OPTIONS } from '@/lib/library/verify-generation-job';
import { startJobQueue } from '@/lib/jobs/app-job-queue';
import type { JobQueue } from '@/lib/jobs/types';

const logger = apiLogger.child({ route: '/api/v1/library' });

const IDEMPOTENCY_KEY_REQUIRED_MESSAGE =
  'Idempotency-Key header is required: a register call creates a durable copy and cannot be retried safely without one.';

/**
 * The contract's replay is a CURRENT-RESOURCE read: the record as it is now
 * (settled verification, later annotations), never the body the original
 * call returned. So nothing is stored as the claim's response and the
 * record is read again on every replay.
 */
async function replayResponse(tenantId: string, recordId: string): Promise<Response> {
  const record = await getExternalCredentialById(recordId, tenantId);
  if (record === null) {
    // The claim is deleted with its record in one transaction, so a key whose
    // record is gone reads as absent and registers anew. This is reachable
    // only when the delete commits between the claim read above and this
    // record read; the same key, retried, then registers afresh.
    throw new ConflictError(IDEMPOTENCY_KEY_RECORD_DELETED_MESSAGE, 'IDEMPOTENCY_KEY_RECORD_DELETED');
  }
  return created(record);
}

/**
 * The 201 for a record, projected onto the contract. A row the projection
 * cannot express is a broken invariant whose message names rows and runs, so
 * it becomes the sanitised 500 rather than reaching the caller.
 */
function created(record: ExternalCredentialRecord): Response {
  let projected: CredentialRecordResponse;
  try {
    projected = toCredentialRecord(record);
  } catch (error) {
    if (error instanceof CredentialRecordProjectionError || error instanceof LibraryRecordShapeError) {
      return sanitisedServerError(error, 'The library record could not be projected');
    }
    throw error;
  }
  return NextResponse.json(projected, { status: 201 });
}

/**
 * The contract's 400 for the body and the header, with the code it names.
 * Anything that is not a validation failure is left to the route error mapper.
 */
function rethrowAsValidationFailed(error: unknown): never {
  if (error instanceof ValidationError) {
    throw new ValidationError(error.message, { code: 'VALIDATION_FAILED', cause: error });
  }
  throw error;
}

/**
 * Errors this route owes a sanitised 500 for: broken invariants whose
 * messages name rows, claims and internal shapes, which the route error
 * mapper's fallback would otherwise echo.
 */
function sanitisedServerError(error: Error, detail: string): Response {
  logger.error({ err: error }, detail);
  return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
}

/**
 * @swagger
 * /library:
 *   post:
 *     summary: Register a credential received from a third party
 *     description: |
 *       Fetches the credential at `sourceUrl` through the guarded fetch stack,
 *       opens it with the supplied key when the source is encrypted, reads
 *       its descriptive fields, stores a durable copy, and creates a library
 *       record whose generation 1 verification is settled in this call for
 *       every outcome except the verifier call itself, which runs in the
 *       background, on the worker process, and settles the record from
 *       `pending`. `pending` has no upper bound: it settles when a worker
 *       runs the check, and a deployment with no worker running leaves it
 *       `pending`. The read operation that reports the settled state arrives
 *       with a later part of the library.
 *
 *       Every branch's outcome is on the returned record's `verification`
 *       envelope. A source that could not be fetched is `RETRIEVAL_FAILED`
 *       (`retryable` says whether the same request may succeed later). An
 *       encrypted source with no key is `DECRYPTION_REQUIRED`, with a key
 *       that did not open it `DECRYPTION_FAILED`; both keep the ciphertext
 *       exactly as fetched as the durable copy, with `hasKey: false`. A copy
 *       that could not be written is `STORAGE_FAILED`. A body that was
 *       fetched but is not a signed credential is stored as fetched and
 *       settles `not_conformant`.
 *
 *       `detailsStatus` is per record: `EXTRACTED` once the artefact was
 *       read, `EXTRACTION_PENDING` while it has not been reached (a failed
 *       fetch, an unopened ciphertext), `EXTRACTION_FAILED` when it was
 *       reached and could not be read. `encrypted` is `null` until a body
 *       has been observed.
 *
 *       The decryption key is used for this request and then forgotten: it
 *       is never stored, logged, queued or returned. Serve this endpoint
 *       over HTTPS so the key is protected in transit.
 *
 *       `Idempotency-Key` is required. A retry with the same key and the
 *       same body returns the record as it is now (a current-resource
 *       replay) with `201` again, never a duplicate. A key whose request
 *       was rejected before a record was written (any `400`, any `500`
 *       other than a failure to project a record that was already written)
 *       is not consumed by that request and may be reused once the problem
 *       is corrected. Redirects
 *       are followed; the record keeps the requested URL, in its canonical
 *       form, as `sourceUrl`. `sourceUrl` is at most 2048 characters,
 *       `annotations.displayName` at most 200, `annotations.notes` at most
 *       2000, and `sourceEncryption.decryptionKey` is an AES-256-GCM key as 64
 *       hexadecimal characters; a value outside those bounds is a `400` naming
 *       the field.
 *     tags:
 *       - Library
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *         description: |
 *           A caller-chosen value unique per attempt; a UUID is
 *           recommended. Printable ASCII, 1 to 255 characters. Missing,
 *           blank, over-long or malformed is a `400` naming the header.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterExternalCredentialRequest'
 *     responses:
 *       201:
 *         description: |
 *           The record was created, or the same key and body were replayed.
 *           `verification` says which outcome applied.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialRecord'
 *       400:
 *         description: |
 *           `VALIDATION_FAILED`: the body failed validation, `sourceUrl` is
 *           not an absolute http(s) URL without embedded credentials, or the
 *           `Idempotency-Key` header is missing or malformed. The message
 *           names the field or header. `SOURCE_NOT_PERMITTED`: the source is
 *           a private or reserved network address, or the guard refused to
 *           fetch it. A body that could not be read at all is a `400` with
 *           no code. No record is created for any of these.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               idempotencyKeyMissing:
 *                 value:
 *                   error: 'Idempotency-Key header is required: a register call creates a durable copy and cannot be retried safely without one.'
 *                   code: VALIDATION_FAILED
 *               sourceNotPermitted:
 *                 value:
 *                   error: Hostname resolves to a private or reserved address
 *                   code: SOURCE_NOT_PERMITTED
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       409:
 *         description: |
 *           `IDEMPOTENCY_KEY_IN_FLIGHT`: a request with this key is still
 *           being processed, or another request took the key while this one
 *           ran; retry to receive that request's result.
 *           `IDEMPOTENCY_KEY_RECORD_DELETED`: the record this key produced
 *           was deleted while this request was being answered; retry the
 *           request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               stillProcessing:
 *                 value:
 *                   error: A request with this Idempotency-Key is still being processed. Retry shortly.
 *                   code: IDEMPOTENCY_KEY_IN_FLIGHT
 *               heldElsewhere:
 *                 value:
 *                   error: Another request now holds this Idempotency-Key. Retry to receive that request's result.
 *                   code: IDEMPOTENCY_KEY_IN_FLIGHT
 *               recordDeleted:
 *                 value:
 *                   error: The record this Idempotency-Key produced was deleted while this request was being answered; retry the request.
 *                   code: IDEMPOTENCY_KEY_RECORD_DELETED
 *       422:
 *         description: '`IDEMPOTENCY_KEY_MISMATCH`: this key was already used with a different request body.'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               keyReusedWithDifferentBody:
 *                 value:
 *                   error: This Idempotency-Key was already used with a different request body.
 *                   code: IDEMPOTENCY_KEY_MISMATCH
 *       500:
 *         description: |
 *           `CREDENTIALS_ENCRYPTION_UNAVAILABLE`: this service cannot protect
 *           the storage key a durable copy of an opened credential needs.
 *           The fetch and any decrypt already ran; no copy is stored and no
 *           record is created. Any other server error carries no code.
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
export const POST = withTenantAuth(async (req, context) => {
  try {
    return await register(req, context.tenantId);
  } catch (error) {
    // The shared mapper answers the typed errors (400, 409, 422) and echoes
    // the message of anything else. On this route an unmapped failure is a
    // deployment's own business (a service instance's configuration, a
    // storage adapter's exception), so everything the mapper would echo is
    // sanitised here before it reaches the mapper.
    if (isMappedRouteError(error)) throw error;
    if (error instanceof EncryptionUnavailableError) {
      logger.error({ err: error, tenantId: context.tenantId }, 'Encryption is not available; no record was created');
      return NextResponse.json({ error: error.message, code: 'CREDENTIALS_ENCRYPTION_UNAVAILABLE' }, { status: 500 });
    }
    return sanitisedServerError(error instanceof Error ? error : new Error(String(error)), 'Registration failed');
  }
});

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

async function register(req: Request, tenantId: string): Promise<Response> {
  let idempotencyKey: string | undefined;
  try {
    idempotencyKey = parseIdempotencyKeyHeader(req);
  } catch (error) {
    rethrowAsValidationFailed(error);
  }
  if (idempotencyKey === undefined) {
    throw new ValidationError(IDEMPOTENCY_KEY_REQUIRED_MESSAGE, { code: 'VALIDATION_FAILED' });
  }

  // The raw bytes are digested before parsing so a retry is classified
  // against the stored body even when validation would now fail differently.
  // The plain digest the issuance route uses. The body may carry a
  // supplier's decryption key, and the digest is persisted, but the key the
  // schema admits is a 256-bit AES key, so a digest of the body gives a
  // database reader nothing to test guesses against.
  const requestBytes = await readRequestBytes(req);
  const bodyDigest = await digestRequestBody(requestBytes);
  const rawBody = new TextDecoder().decode(requestBytes);
  const idempotency = {
    tenantId,
    operation: IdempotencyOperation.LIBRARY_REGISTER,
    key: idempotencyKey,
    bodyDigest,
  };

  const existing = await findIdempotencyKey(idempotency);
  if (existing.outcome === 'mismatch' || existing.outcome === 'in-flight') {
    throwIdempotencyClassification(existing.outcome);
  }
  if (existing.outcome === 'replay') {
    return replayResponse(tenantId, existing.recordId);
  }

  let body: RegisterExternalCredentialRequest;
  try {
    body = await parseRequestBody({ json: async () => JSON.parse(rawBody) }, registerExternalCredentialRequestSchema);
  } catch (error) {
    rethrowAsValidationFailed(error);
  }
  // The canonical href, not the caller's string, is what is fetched, stored
  // and logged, so validation and fetching cannot diverge on parser
  // differentials (the verify and issue routes' invariant).
  let sourceUrl: string;
  try {
    sourceUrl = assertHttpUrl(body.sourceUrl, 'sourceUrl').href;
  } catch (error) {
    rethrowAsValidationFailed(error);
  }

  // The queue is a precondition of the work, so it is checked before the
  // key is claimed: a queue that cannot start ends the request with no
  // record and no claim to release. Its errors name the deployment's own
  // wiring, which the caller cannot act on, so they are sanitised.
  let queue: JobQueue;
  try {
    queue = await startJobQueue();
  } catch (error) {
    return sanitisedServerError(
      error instanceof Error ? error : new Error(String(error)),
      'The job queue could not be started',
    );
  }

  // The claim is held before any fetch, so two concurrent requests with one
  // new key cannot both create a record (ADR-051), and released on every
  // path that ends with no record.
  const claim = await claimIdempotencyKey(idempotency);
  if (claim.outcome === 'mismatch' || claim.outcome === 'in-flight') {
    throwIdempotencyClassification(claim.outcome);
  }
  if (claim.outcome === 'replay') {
    return replayResponse(tenantId, claim.recordId);
  }
  const claimId = claim.claimId;

  // The source's origin, not its full URL: a supplier's link can carry a
  // capability token in its path or query, which belongs with the record,
  // not in the log stream.
  const source = new URL(sourceUrl).origin;
  logger.info({ tenantId, source }, 'Registering an external credential');
  let record: ExternalCredentialRecord;
  try {
    record = await registerExternalCredential(
      {
        tenantId,
        sourceUrl,
        ...(body.sourceEncryption !== undefined ? { decryptionKey: body.sourceEncryption.decryptionKey } : {}),
        annotations: {
          displayName: body.annotations.displayName,
          declaredCredentialType: body.annotations.declaredCredentialType,
          ...(body.annotations.dateReceived !== undefined
            ? { dateReceived: new Date(`${body.annotations.dateReceived}T00:00:00Z`) }
            : {}),
          ...(body.annotations.notes !== undefined ? { notes: body.annotations.notes } : {}),
        },
        idempotencyClaimId: claimId,
      },
      defaultRegisterDependencies((sql, job) =>
        queue.enqueueWithin(sql, LIBRARY_VERIFY_JOB, job, VERIFY_JOB_ENQUEUE_OPTIONS),
      ),
    );
  } catch (error) {
    if (error instanceof IdempotencyClaimLostError) {
      throw new ConflictError(IDEMPOTENCY_KEY_HELD_ELSEWHERE_MESSAGE, 'IDEMPOTENCY_KEY_IN_FLIGHT');
    }
    await releaseClaim(claimId, idempotencyKey);
    if (error instanceof SourceRejectedError) {
      throw new ValidationError(error.message, {
        code: error.failure.reason === 'source-not-permitted' ? 'SOURCE_NOT_PERMITTED' : 'VALIDATION_FAILED',
        cause: error,
      });
    }
    if (error instanceof EncryptionUnavailableError) {
      logger.error({ err: error, tenantId, source }, 'Encryption preflight failed; no record was created');
      return NextResponse.json({ error: error.message, code: 'CREDENTIALS_ENCRYPTION_UNAVAILABLE' }, { status: 500 });
    }
    if (error instanceof IdempotencyClaimOperationMismatchError) {
      return sanitisedServerError(error, 'The register claim could not be linked to its record');
    }
    if (error instanceof StorageKeyMissingError) {
      return sanitisedServerError(error, 'The storage service returned no key for an encrypted copy');
    }
    throw error;
  }

  // The claim is finalised with no body: a replay reads the record itself.
  // A failure here leaves the claim recorded-but-unfinalised, which a retry
  // sees as in-flight until the stale window passes and then replays, so
  // the record is never produced twice; the log line is the only trace.
  try {
    await completeIdempotencyKey({ claimId, recordId: record.record.id, responseBody: null });
  } catch (error) {
    logger.error(
      { err: error, claimId, recordId: record.record.id },
      'Failed to finalise the register Idempotency-Key',
    );
  }

  logger.info(
    { tenantId, recordId: record.record.id, state: record.checkRun.state, failureCode: record.checkRun.failureCode },
    'External credential registered',
  );
  return created(record);
}

async function releaseClaim(claimId: string, idempotencyKey: string): Promise<void> {
  try {
    const { applied } = await releaseIdempotencyKey({ claimId });
    if (!applied) {
      logger.warn({ claimId }, 'Registration failed but the Idempotency-Key claim was no longer owned');
    }
  } catch (releaseError) {
    logger.error(
      { err: releaseError, claimId, idempotencyKeyLength: idempotencyKey.length },
      'Failed to release the register Idempotency-Key',
    );
  }
}
