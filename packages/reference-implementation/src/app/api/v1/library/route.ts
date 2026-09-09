import { TextDecoder } from 'node:util';
import { NextResponse } from 'next/server';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';
import { apiLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
  UnprocessableError,
  unexpectedErrorMessage,
} from '@/lib/api/errors';
import { assertHttpUrl, parseRequestBody, parseQueryParams, ValidationError } from '@/lib/api/validation';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
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
  listLibraryQuerySchema,
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
  DuplicateCredentialError,
  getExternalCredentialById,
  type ExternalCredentialRecord,
} from '@/lib/prisma/repositories/external-credential.repository';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import {
  CredentialRecordProjectionError,
  toNativeCredentialRecord,
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
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import { listLibraryRecords } from '@/lib/prisma/repositories/library-record.repository';

const logger = apiLogger.child({ route: '/api/v1/library' });

const IDEMPOTENCY_KEY_REQUIRED_MESSAGE =
  'Idempotency-Key header is required: a register call creates a durable copy and cannot be retried safely without one.';

const FREE_TEXT_SEARCH_DEFERRED_MESSAGE = 'Free-text search is not yet available in v1.';

function hasLibraryQueryNul(query: {
  organisationId?: string;
  facilityId?: string;
  productId?: string;
  issuer?: string;
}): boolean {
  // PostgreSQL rejects NUL in a text parameter with SQLSTATE 22021; an empty
  // page preserves the caller's filter without turning it into a server error.
  return [query.organisationId, query.facilityId, query.productId, query.issuer].some(
    (value) => value?.includes('\0') === true,
  );
}

function listResponse(data: CredentialRecordResponse[], total: number, limit?: number, offset?: number): Response {
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * @swagger
 * /library:
 *   get:
 *     operationId: listLibrary
 *     summary: List and search the tenant's credential library
 *     description: |
 *       Returns native credentials issued by this tenant and external
 *       credentials received and registered by it in one paginated view.
 *       Every row is keyless and carries no durable-copy storage location;
 *       use `GET /api/v1/library/{id}` for those fields. v1 has no
 *       supersession or versioning filter, so every record is returned when
 *       it matches the other filters.
 *
 *       `type` is repeatable and uses the extracted core type when present,
 *       otherwise the external record's declared type. `issuer` compares an
 *       issuer name case-insensitively or a DID exactly. Association filters
 *       match native records only. The `issuedAt` sort and date bounds use
 *       `validFrom`, falling back to `createdAt`; the response's `issuedAt`
 *       stays `validFrom` and is null when that is null. Every sort has an
 *       ascending id tie-breaker.
 *     tags:
 *       - Library
 *     parameters:
 *       - in: query
 *         name: type
 *         description: Repeatable OR filter for the credential's core type. Extracted type takes precedence over the external declaration. A native record with no recorded core type matches no value until an extraction records one; a record whose types name no core kind never matches a `type` value.
 *         schema:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CredentialType'
 *         style: form
 *         explode: true
 *       - in: query
 *         name: origin
 *         description: Filter by native or external provenance.
 *         schema:
 *           $ref: '#/components/schemas/Origin'
 *       - in: query
 *         name: organisationId
 *         description: Exact non-blank native organisation id. External records never match.
 *         schema:
 *           type: string
 *           minLength: 1
 *       - in: query
 *         name: facilityId
 *         description: Exact non-blank native facility id. External records never match.
 *         schema:
 *           type: string
 *           minLength: 1
 *       - in: query
 *         name: productId
 *         description: Exact non-blank native product id. External records never match.
 *         schema:
 *           type: string
 *           minLength: 1
 *       - in: query
 *         name: issuer
 *         description: Exact non-blank issuer name ignoring case, or exact issuer DID.
 *         schema:
 *           type: string
 *           minLength: 1
 *       - in: query
 *         name: encrypted
 *         description: Whether the record's observed body or native stored copy is encrypted. Null external observations match neither value.
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: status
 *         description: Filter by the derived verification summary.
 *         schema:
 *           $ref: '#/components/schemas/VerificationSummary'
 *       - in: query
 *         name: issuedFrom
 *         description: Inclusive UTC lower bound on effective issuedAt, falling back to createdAt. A reversed range is a 400 validation error.
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: issuedTo
 *         description: Inclusive UTC upper bound on effective issuedAt, falling back to createdAt. A reversed range is a 400 validation error.
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: sort
 *         description: Sort field and direction. Ties are broken by id ascending.
 *         schema:
 *           type: string
 *           enum: [issuedAt:asc, issuedAt:desc, createdAt:asc, createdAt:desc]
 *           default: issuedAt:desc
 *       - in: query
 *         name: q
 *         description: Reserved free-text search parameter. Rejected in v1 with FREE_TEXT_SEARCH_DEFERRED.
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         description: Page size. Defaults to the smaller of 20 and the configured deployment maximum. Values above the deployment maximum are rejected with PAGE_LIMIT_EXCEEDED.
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: offset
 *         description: Number of matching records to skip.
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: A keyless page of the tenant's library.
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *               enum: [no-store]
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data, pagination]
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CredentialRecord'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *             examples:
 *               mixedPage:
 *                 value:
 *                   data:
 *                     - id: cred_ext_05
 *                       origin: external
 *                       credential: { name: Cobalt Shipment DFR, credentialType: DFR, issuerName: Cobalt Traders Ltd, issuerDid: did:web:cobalt-traders.example, subjectName: Cobalt shipment CB-2201, subjectId: https://cobalt-traders.example/shipments/CB-2201, validFrom: '2026-07-20T10:00:00Z', validUntil: null }
 *                       annotations: { annotationVersion: 1, displayName: Cobalt shipment DFR, declaredCredentialType: DFR, dateReceived: '2026-07-30', notes: '' }
 *                       organisationId: null
 *                       facilityId: null
 *                       productId: null
 *                       sourceUrl: https://supplier.example/credential-d
 *                       sourceDigest: zQm-cobalt-digest
 *                       resolverUri: null
 *                       issuedAt: '2026-07-20T10:00:00Z'
 *                       encrypted: false
 *                       hasKey: true
 *                       verification: { generation: 1, state: complete, requestedAt: '2026-07-30T09:00:00Z', completedAt: '2026-07-30T09:00:06Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: pass, status: pass, temporal: pass, schemaConformance: pass }, summary: verified }
 *                       currencyStatus: current
 *                       detailsStatus: EXTRACTED
 *                       detailsError: null
 *                       capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                       warnings: []
 *                       createdAt: '2026-07-30T09:00:00Z'
 *                       updatedAt: '2026-07-30T09:00:06Z'
 *                     - id: cjld2cyuq0000qzrmf1w70eq3
 *                       origin: native
 *                       credential: { name: Battery Pack DPP, credentialType: DPP, issuerName: Acme Battery Co, issuerDid: did:web:acme.example, subjectName: Battery Pack Model X, subjectId: https://acme.example/products/battery-x, validFrom: '2026-07-15T09:00:00Z', validUntil: '2029-07-15T09:00:00Z' }
 *                       annotations: null
 *                       organisationId: cjld2cyuq0001qzrmf1w70eq4
 *                       facilityId: cjld2cyuq0002qzrmf1w70eq5
 *                       productId: cjld2cyuq0003qzrmf1w70eq6
 *                       sourceUrl: null
 *                       sourceDigest: null
 *                       resolverUri: null
 *                       issuedAt: '2026-07-15T09:00:00Z'
 *                       encrypted: true
 *                       hasKey: true
 *                       verification: { generation: 1, state: complete, requestedAt: '2026-07-15T09:00:00Z', completedAt: '2026-07-15T09:00:00Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: pass, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: verified }
 *                       currencyStatus: current
 *                       detailsStatus: EXTRACTED
 *                       detailsError: null
 *                       capabilities: { deletable: false, annotatable: false, verifiable: true }
 *                       warnings: []
 *                       createdAt: '2026-07-15T09:00:00Z'
 *                       updatedAt: '2026-07-15T09:00:00Z'
 *                   pagination: { total: 2, limit: 20, offset: 0, hasMore: false }
 *       400:
 *         description: Validation failure, including a reversed date range, PAGE_LIMIT_EXCEEDED, or FREE_TEXT_SEARCH_DEFERRED.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       500:
 *         description: The selected records could not be read or projected. The body is sanitised and carries a correlation id.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);
  if (url.searchParams.has('q')) {
    throw new ValidationError(FREE_TEXT_SEARCH_DEFERRED_MESSAGE, { code: 'FREE_TEXT_SEARCH_DEFERRED' });
  }

  const query = parseQueryParams(url, listLibraryQuerySchema, { repeatable: ['type'] });
  if (hasLibraryQueryNul(query)) {
    return listResponse([], 0, query.limit, query.offset);
  }

  const issuedFrom = query.issuedFrom === undefined ? undefined : new Date(`${query.issuedFrom}T00:00:00.000Z`);
  const issuedTo = query.issuedTo === undefined ? undefined : new Date(`${query.issuedTo}T23:59:59.999Z`);

  try {
    const { data, total } = await listLibraryRecords({
      tenantId,
      type: query.type,
      origin: query.origin,
      organisationId: query.organisationId,
      facilityId: query.facilityId,
      productId: query.productId,
      issuer: query.issuer,
      encrypted: query.encrypted,
      status: query.status,
      issuedFrom,
      issuedTo,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    });
    const now = new Date(Date.now());
    const projected = data.map((view) =>
      view.origin === LibraryRecordOrigin.NATIVE
        ? toNativeCredentialRecord(view, { now })
        : toCredentialRecord(view, { now }),
    );
    return listResponse(projected, total, query.limit, query.offset);
  } catch (error) {
    if (!isDatabaseError(error)) {
      return sanitisedServerError(
        error instanceof Error ? error : new Error(String(error)),
        'The library records could not be listed',
      );
    }
    throw error;
  }
});

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
 * Errors this route owes a sanitised 500 for: broken invariants whose
 * messages name rows, claims and internal shapes, which the route error
 * mapper's fallback would otherwise echo.
 */
function sanitisedServerError(error: Error, detail: string): Response {
  logger.error({ error: safeError(error) }, detail);
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
 *       `pending`. A deployment with no worker running leaves it `pending`.
 *       Where a worker is running and the generation has not settled within
 *       the sweep's bound, its reconciliation sweep settles the generation as
 *       retryable `VERIFICATION_UNAVAILABLE`. The bound is a policy of at
 *       least 30 minutes, not proof the job is gone, and the sweep does not
 *       re-enqueue the job. Re-poll `GET /api/v1/library/{id}` to read the
 *       settled state.
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
 *       is corrected.
 *
 *       If the opened signed credential already belongs to an external
 *       record in this tenant, the request is rejected with
 *       `DUPLICATE_CREDENTIAL`. The response names the existing record, and
 *       its `Location` header carries that record's path. The key is not
 *       consumed by this rejection, so the same key may be reused once the
 *       duplicate is resolved. The comparison runs after decryption and
 *       extraction, before the durable copy is stored. Native records are
 *       outside this comparison. A record whose durable copy failed to
 *       store, or whose credential could not be read, still holds the
 *       content's identity and still blocks a fresh registration of it.
 *
 *       Redirects
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
 *           request. `DUPLICATE_CREDENTIAL` means the opened signed
 *           credential already belongs to an external record in this tenant.
 *           The `Location` header names that record. A record whose durable
 *           copy failed to store, or whose credential could not be read,
 *           still holds the content's identity and still blocks a fresh
 *           registration of it. The request's Idempotency-Key is not
 *           consumed by this rejection, so the same key may be reused once
 *           the duplicate is resolved.
 *         headers:
 *           Location:
 *             description: |
 *               Present only on `DUPLICATE_CREDENTIAL`. Relative path of the
 *               existing library record holding the credential's content.
 *             schema:
 *               type: string
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
 *               duplicateCredential:
 *                 value:
 *                   error: This credential is already registered as record clw0dup1ic4terecord000001.
 *                   code: DUPLICATE_CREDENTIAL
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
      // The wrapper's own message says only that encryption is unavailable.
      // The reason an operator can act on, a missing or unusable
      // DATA_ENCRYPTION_KEY, is on its cause, so that one level is carried
      // too. Reduced the same way, so nothing deeper than it is rendered.
      logger.error(
        { error: safeError(error), cause: safeError(error.cause), tenantId: context.tenantId },
        'Encryption is not available; no record was created',
      );
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
    if (error instanceof DuplicateCredentialError) {
      // Built here rather than through the shared mapper, which sets no
      // headers. That bypasses the mapper's conflict log line too, so this
      // rejection logs its own, covering the in-request lookup and the
      // database index alike.
      logger.warn({ tenantId, source, existingRecordId: error.existingRecordId }, 'Duplicate credential content');
      return NextResponse.json(
        {
          error: `This credential is already registered as record ${error.existingRecordId}.`,
          code: 'DUPLICATE_CREDENTIAL',
        },
        {
          status: 409,
          headers: { Location: `/api/v1/library/${error.existingRecordId}` },
        },
      );
    }
    if (error instanceof SourceRejectedError) {
      throw new ValidationError(error.message, {
        code: error.failure.reason === 'source-not-permitted' ? 'SOURCE_NOT_PERMITTED' : 'VALIDATION_FAILED',
        cause: error,
      });
    }
    if (error instanceof EncryptionUnavailableError) {
      // Same as the listing path above: the actionable reason is the cause,
      // and only its name and message are rendered.
      logger.error(
        { error: safeError(error), cause: safeError(error.cause), tenantId, source },
        'Encryption preflight failed; no record was created',
      );
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
      { error: safeError(error), claimId, recordId: record.record.id },
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
      { error: safeError(releaseError), claimId, idempotencyKeyLength: idempotencyKey.length },
      'Failed to release the register Idempotency-Key',
    );
  }
}
