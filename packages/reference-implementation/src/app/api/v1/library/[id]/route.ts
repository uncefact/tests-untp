import { NextResponse } from 'next/server';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  unexpectedErrorMessage,
} from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { parseRequestBody, definedFields, ValidationError } from '@/lib/api/validation';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
import { strictIntQueryParam } from '@/lib/api/request-schemas/shared';
import {
  updateLibraryAnnotationsRequestSchema,
  type UpdateLibraryAnnotationsRequest,
} from '@/lib/api/request-schemas/library';
import { revealDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import {
  CredentialRecordProjectionError,
  toCredentialRecord,
  toCredentialRecordDetail,
} from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import {
  getLibraryRecordById,
  LibraryRecordWriteAnomalyError,
  updateLibraryRecordAnnotations,
  type LibraryRecordAnnotationChanges,
} from '@/lib/prisma/repositories/library-record.repository';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';

const logger = apiLogger.child({ route: '/api/v1/library/[id]' });

/**
 * A stored key could not be revealed. It carries its own class because the
 * thrown message names `DATA_ENCRYPTION_KEY`, which is the operator's
 * business and never the caller's, so the route must be able to tell this
 * failure apart from every other one and answer it with the sanitised 500.
 */
class DecryptionKeyRevealError extends Error {
  constructor(cause: unknown) {
    super('The stored credential decryption key could not be revealed', { cause });
    this.name = 'DecryptionKeyRevealError';
  }
}

function revealForDetail(stored: string): string {
  try {
    return revealDecryptionKey(stored);
  } catch (error) {
    throw new DecryptionKeyRevealError(error);
  }
}

/**
 * The 500 for every failure either operation on this route owns. The error is
 * logged with the record it happened on, under pino's `err` key so the message,
 * stack and cause chain are all rendered. No error in this chain carries key
 * material: the decrypt failure is Node's own authentication error, the
 * projection and shape failures name rows rather than values, and the
 * annotation update never reveals a stored key at all.
 */
function sanitisedServerError(error: unknown, recordId: string, detail: string): Response {
  logger.error({ err: error, recordId }, detail);
  return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
}

/**
 * @swagger
 * /library/{id}:
 *   get:
 *     operationId: getLibraryRecord
 *     summary: Retrieve one library record
 *     description: |
 *       Returns one tenant-owned library record of either origin, including
 *       the Reference Implementation's durable-copy location, its
 *       storage-integrity digest, and the key that opens that copy when this
 *       service holds one. This is also the verification poll target.
 *       While `verification.state` is `pending`, re-poll this endpoint until
 *       it settles to `complete` or `failed`. A worker reconciliation sweep
 *       settles a pending generation that has not reported a result within
 *       its bound. It records a retryable `VERIFICATION_UNAVAILABLE` failure,
 *       and a re-verification then creates the next generation.
 *
 *       `storageUri` is the Reference Implementation's durable-copy location
 *       and is distinct from an external record's `sourceUrl`. An external
 *       record can have a storage URI while `decryptionKey` is null when it
 *       holds unopened ciphertext. A record with no durable copy yet returns
 *       all three custody fields as null.
 *
 *       `hasKey` and `decryptionKey` report the stored custody state as it is
 *       now. A later re-verification that proves the durable copy lost does
 *       not clear or change them, so a key can still be returned for a copy
 *       that no longer answers. The newest verification envelope reports
 *       `STORED_COPY_UNAVAILABLE` (or `STORED_COPY_CORRUPT` for a copy that
 *       read back but failed its digest check) and its retryability instead.
 *
 *       For a native record, `verification` generation 1 is an issuance
 *       assertion rather than an executed run. `proof` reads `pass` because
 *       this service signed the artefact moments earlier, and no check was
 *       run. Generation 2 onward is executed. Every generation of an external
 *       record is executed. A settled external generation may also carry
 *       `sourceChanged` and `lastSourceCheckAt` when its supplier source was
 *       checked against the pinned copy's source digest. The fields are
 *       absent from pending generations.
 *
 *       The response is never cached. A missing id and an id owned by another
 *       tenant return the same 404 response.
 *
 *       A stored key that cannot be revealed, or a stored value that resembles
 *       but is not a valid encryption envelope, returns a sanitised 500 with
 *       the request correlation id. This interim behaviour is tracked by
 *       uncefact/tests-untp#769.
 *     tags:
 *       - Library
 *     parameters:
 *       - $ref: '#/components/parameters/LibraryRecordId'
 *     responses:
 *       200:
 *         description: |
 *           The library record with its durable-copy coordinates and key when
 *           available. This response always carries `Cache-Control: no-store`.
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *               enum: [no-store]
 *             description: Always no-store because this response can expose key material.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialRecordDetail'
 *             examples:
 *               nativeEncrypted:
 *                 summary: Native credential with an encrypted durable copy
 *                 value:
 *                   id: clw0n4t1v3encrypted000001
 *                   origin: native
 *                   credential: { name: Battery Pack DPP, credentialType: DPP, issuerName: Acme Battery Co, issuerDid: 'did:web:acme.example', subjectName: Battery Pack Model X, subjectId: 'https://acme.example/products/battery-x', validFrom: '2026-07-15T09:00:00.000Z', validUntil: '2029-07-15T09:00:00.000Z' }
 *                   annotations: null
 *                   organisationId: clw0org4n1s4t10n00000001
 *                   facilityId: clw0f4c1l1ty000000000001
 *                   productId: clw0pr0duct000000000001a
 *                   sourceUrl: null
 *                   sourceDigest: null
 *                   resolverUri: null
 *                   issuedAt: '2026-07-15T09:00:00.000Z'
 *                   encrypted: true
 *                   hasKey: true
 *                   verification: { generation: 1, state: complete, requestedAt: '2026-07-15T09:00:00.000Z', completedAt: '2026-07-15T09:00:00.000Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: pass, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: verified }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: false, annotatable: false, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-07-15T09:00:00.000Z'
 *                   updatedAt: '2026-07-15T09:00:00.000Z'
 *                   storageUri: 'https://storage.internal.example/credentials/clw0n4t1v3encrypted000001'
 *                   digestMultibase: zQmNativeStorageDigestExample
 *                   decryptionKey: '3f2a1c9d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d'
 *               nativeUnencrypted:
 *                 summary: Native credential with a plaintext durable copy
 *                 value:
 *                   id: clw0n4t1v3plaintext000002
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
 *                   encrypted: false
 *                   hasKey: false
 *                   verification: { generation: 1, state: complete, requestedAt: '2026-07-15T09:00:00.000Z', completedAt: '2026-07-15T09:00:00.000Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: pass, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: verified }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: false, annotatable: false, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-07-15T09:00:00.000Z'
 *                   updatedAt: '2026-07-15T09:00:00.000Z'
 *                   storageUri: 'https://storage.internal.example/credentials/clw0n4t1v3plaintext000002'
 *                   digestMultibase: zQmNativePlaintextDigestExample
 *                   decryptionKey: null
 *               externalProtected:
 *                 summary: External credential with the receiver-side key
 *                 value:
 *                   id: clw0ext3rn4lprotect000003
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: Received by email }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceBytesDigestExample
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 1, state: complete, requestedAt: '2026-08-30T10:20:00.000Z', completedAt: '2026-08-30T10:20:04.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: pass, status: pass, temporal: pass, schemaConformance: pass }, summary: verified }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-08-30T10:20:00.000Z'
 *                   storageUri: 'https://storage.internal.example/credentials/clw0ext3rn4lprotect000003'
 *                   digestMultibase: zQmExternalStorageDigestExample
 *                   decryptionKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f801'
 *               externalUnopened:
 *                 summary: External unopened ciphertext with no receiver-side key
 *                 value:
 *                   id: clw0ext3rn4lunopened00004
 *                   origin: external
 *                   credential: { name: null, credentialType: null, issuerName: null, issuerDid: null, subjectName: null, subjectId: null, validFrom: null, validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Encrypted DPP from Supplier Ltd, declaredCredentialType: DPP, dateReceived: '2026-08-30', notes: Key still to come }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/encrypted-dpp'
 *                   sourceDigest: zQmCiphertextBytesDigestExample
 *                   resolverUri: null
 *                   issuedAt: null
 *                   encrypted: true
 *                   hasKey: false
 *                   verification: { generation: 1, state: failed, requestedAt: '2026-08-30T11:05:00.000Z', completedAt: '2026-08-30T11:05:02.000Z', checks: { retrieval: pass, decryption: fail, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: failed, failure: { code: DECRYPTION_REQUIRED, message: 'The fetched credential is encrypted and this service holds no key that opens it. The copy is kept as fetched. Supplying a key later is not supported yet.', retryable: true } }
 *                   currencyStatus: unknown
 *                   detailsStatus: EXTRACTION_PENDING
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T11:05:00.000Z'
 *                   updatedAt: '2026-08-30T11:05:00.000Z'
 *                   storageUri: 'https://storage.internal.example/credentials/clw0ext3rn4lunopened00004'
 *                   digestMultibase: zQmExternalCiphertextDigestExample
 *                   decryptionKey: null
 *               externalNoCopy:
 *                 summary: External record awaiting a durable copy
 *                 value:
 *                   id: clw0ext3rn4lnocopy0000005
 *                   origin: external
 *                   credential: { name: null, credentialType: null, issuerName: null, issuerDid: null, subjectName: null, subjectId: null, validFrom: null, validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Unreachable DPP from Supplier Ltd, declaredCredentialType: DPP, dateReceived: '2026-08-30', notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/unavailable'
 *                   sourceDigest: null
 *                   resolverUri: null
 *                   issuedAt: null
 *                   encrypted: null
 *                   hasKey: false
 *                   verification: { generation: 1, state: failed, requestedAt: '2026-08-30T11:40:00.000Z', completedAt: '2026-08-30T11:40:09.000Z', checks: { retrieval: fail, decryption: not_run, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: failed, failure: { code: RETRIEVAL_FAILED, message: 'The source could not be reached. Retry via re-verify once the source is reachable.', retryable: true } }
 *                   currencyStatus: unknown
 *                   detailsStatus: EXTRACTION_PENDING
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T11:40:00.000Z'
 *                   updatedAt: '2026-08-30T11:40:00.000Z'
 *                   storageUri: null
 *                   digestMultibase: null
 *                   decryptionKey: null
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
 *             examples:
 *               notFound:
 *                 value: { error: 'No such credential record.', code: 'NOT_FOUND' }
 *       500:
 *         description: |
 *           The record was read and could not be answered. Three causes reach
 *           this response: the stored decryption key could not be revealed,
 *           the record could not be projected onto this contract, or the
 *           stored record has a shape the write paths never produce. The body
 *           is sanitised and carries a correlation id for the operator. A
 *           database fault is answered by the shared database error responses
 *           instead, as on every other route.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  logger.info({ recordId: id }, 'Looking up library record');
  // Postgres refuses a NUL byte inside a text value (SQLSTATE 22021), so an
  // id carrying one can match no stored record and must not reach the query,
  // where it would surface as an unhandled database error rather than a miss.
  if (id.includes('\0')) {
    throw new NotFoundError('No such credential record.', 'NOT_FOUND');
  }
  try {
    const view = await getLibraryRecordById(id, tenantId);
    if (view === null) {
      throw new NotFoundError('No such credential record.', 'NOT_FOUND');
    }

    const projected = toCredentialRecordDetail(view, { reveal: revealForDetail });
    logger.info(
      {
        recordId: id,
        origin: projected.origin,
        hasKey: projected.hasKey,
        copyPresent: projected.storageUri !== null,
      },
      'Library record retrieved',
    );
    return NextResponse.json(projected, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // The shared mapper owns what it classifies: the not-found above becomes
    // the documented 404, and a database fault takes ADR-036's mapping, whose
    // distinct "Unhandled database error" log is how a missing repository
    // mapping gets noticed. What is left are this route's own failures, whose
    // messages name stored rows, envelopes and the encryption key
    // configuration, so each is answered with the sanitised 500 here.
    if (error instanceof NotFoundError || isDatabaseError(error)) throw error;
    if (error instanceof DecryptionKeyRevealError) {
      return sanitisedServerError(error, id, 'The stored decryption key could not be revealed');
    }
    if (error instanceof CredentialRecordProjectionError) {
      return sanitisedServerError(error, id, 'The library record could not be projected');
    }
    if (error instanceof LibraryRecordShapeError) {
      return sanitisedServerError(error, id, 'The library record has a stored shape the write paths never produce');
    }
    return sanitisedServerError(error, id, 'Library record detail read failed');
  }
});

const INVALID_IF_VERSION_MESSAGE = 'If-Version must be an integer between 1 and 2147483647.';
const MISSING_IF_VERSION_MESSAGE = 'If-Version header is required.';
const VERSION_CONFLICT_MESSAGE = 'The supplied If-Version is stale.';
const NATIVE_ANNOTATION_MESSAGE = 'This is a native credential record; it has no recipient annotations to update.';

function parseIfVersion(req: Request): number {
  const raw = req.headers.get('If-Version');
  if (raw === null) {
    throw new ValidationError(MISSING_IF_VERSION_MESSAGE, { code: 'INVALID_IF_VERSION' });
  }
  // The shared parser carries its own `.optional()`, which only short-circuits
  // on an `undefined` input. The missing-header case is already answered above,
  // so the header value reaching here is always a string and `parsed.data` is
  // never `undefined` at run time. It is still checked, both to narrow the
  // return type to `number` and so a future change to the shared parser cannot
  // turn a missing version into a silent success.
  const parsed = strictIntQueryParam(
    INVALID_IF_VERSION_MESSAGE,
    (value) => value >= 1 && value <= 2147483647,
  ).safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new ValidationError(INVALID_IF_VERSION_MESSAGE, { code: 'INVALID_IF_VERSION' });
  }
  return parsed.data;
}

/**
 * @swagger
 * /library/{id}:
 *   patch:
 *     operationId: annotateLibraryRecord
 *     summary: Update recipient annotations on a library record
 *     description: |
 *       Updates one or more recipient-owned annotation fields on an external
 *       library record. The credential, its durable copy, extracted fields,
 *       verification runs and verification queue are never changed.
 *
 *       Two things beyond the annotations do move. A successful update
 *       advances the record's `updatedAt`, so a client using it as a
 *       change-detection or cache key sees an annotation edit. And changing
 *       `declaredCredentialType` adds or removes the `DECLARED_TYPE_MISMATCH`
 *       warning in the record this request returns, because that warning is
 *       derived from the declared type against the extracted one at projection
 *       time. Neither writes anything else.
 *
 *       The tenant-scoped record lookup runs before the native-origin check,
 *       `If-Version` validation and body validation. A missing or foreign id
 *       therefore returns the same 404, while a native record returns the
 *       named 403 even when the remaining request is invalid. A current token
 *       advances by one; a stale token returns 409 and changes no row.
 *
 *       The header is validated before the body, so a request whose
 *       `If-Version` and body are both invalid reports
 *       `400 INVALID_IF_VERSION`.
 *
 *       `dateReceived` and `notes` accept `null` to clear them. Omitting a
 *       field leaves it unchanged. At least one recognised field is required;
 *       unknown fields are stripped. `displayName` and `notes` cannot contain
 *       a NUL character because PostgreSQL cannot store one.
 *
 *       A projection failure after the transaction commits is answered as a
 *       sanitised 500. The annotation update is already committed in that
 *       case; re-read the record and use its new version before retrying.
 *     tags:
 *       - Library
 *     parameters:
 *       - $ref: '#/components/parameters/LibraryRecordId'
 *       - in: header
 *         name: If-Version
 *         required: true
 *         description: |
 *           The current annotations.annotationVersion. Whitespace,
 *           leading zeroes and a leading plus sign are accepted. An absent
 *           header returns `400 INVALID_IF_VERSION` with the message
 *           `If-Version header is required.`. A malformed or out-of-range
 *           value returns `400 INVALID_IF_VERSION` with the range message; a
 *           valid value that is stale returns `409 VERSION_CONFLICT`.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 2147483647
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/UpdateLibraryAnnotationsRequest'
 *             anyOf:
 *               - required: [displayName]
 *               - required: [declaredCredentialType]
 *               - required: [dateReceived]
 *               - required: [notes]
 *     responses:
 *       200:
 *         description: The updated keyless credential record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialRecord'
 *             examples:
 *               updatedAnnotations:
 *                 summary: A label and declared type update advances the annotation version
 *                 value:
 *                   id: clw0ext3rn4lannotat000001
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 2, displayName: Corrected DCC, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: Received by email }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceBytesDigestExample
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 1, state: complete, requestedAt: '2026-08-30T10:20:00.000Z', completedAt: '2026-08-30T10:20:04.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: pass, status: pass, temporal: pass, schemaConformance: pass }, summary: verified }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-09T10:20:00.000Z'
 *               clearedOptionalAnnotations:
 *                 summary: The cleared date and notes as returned
 *                 value:
 *                   id: clw0ext3rn4lannotat000001
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 3, displayName: Corrected DCC, declaredCredentialType: DCC, dateReceived: null, notes: null }
 *                   organisationId: null
 *                   facilityId: null
 *                   productId: null
 *                   sourceUrl: 'https://supplier.example/credentials/dcc-42'
 *                   sourceDigest: zQmSourceBytesDigestExample
 *                   resolverUri: null
 *                   issuedAt: '2026-08-30T10:15:00.000Z'
 *                   encrypted: false
 *                   hasKey: true
 *                   verification: { generation: 1, state: complete, requestedAt: '2026-08-30T10:20:00.000Z', completedAt: '2026-08-30T10:20:04.000Z', checks: { retrieval: pass, decryption: not_run, digest: pass, proof: pass, status: pass, temporal: pass, schemaConformance: pass }, summary: verified }
 *                   currencyStatus: current
 *                   detailsStatus: EXTRACTED
 *                   detailsError: null
 *                   capabilities: { deletable: true, annotatable: true, verifiable: true }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-09T10:21:00.000Z'
 *       400:
 *         description: Invalid If-Version header or validation failure in the request body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingIfVersion:
 *                 value: { error: 'If-Version header is required.', code: INVALID_IF_VERSION }
 *               invalidIfVersion:
 *                 value: { error: 'If-Version must be an integer between 1 and 2147483647.', code: INVALID_IF_VERSION }
 *               bodyValidationFailed:
 *                 value: { error: 'body: At least one of displayName, declaredCredentialType, dateReceived, or notes is required', code: VALIDATION_FAILED }
 *               malformedJsonBody:
 *                 value: { error: 'Invalid JSON body', code: VALIDATION_FAILED }
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         description: >-
 *           Forbidden. Either of: Forbidden - authenticated principal has no resolvable tenant assignment; or the target is a native credential record where no recipient annotations are permitted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               noTenantForUser:
 *                 summary: The authenticated user maps to no tenant
 *                 value: { error: 'No tenant found for user' }
 *               nativeRecord:
 *                 value: { error: 'This is a native credential record; it has no recipient annotations to update.', code: NATIVE_CREDENTIAL_NOT_ANNOTATABLE }
 *       404:
 *         description: No such credential record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               notFound:
 *                 value: { error: 'No such credential record.', code: NOT_FOUND }
 *       409:
 *         description: The supplied If-Version is stale.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               staleVersion:
 *                 value: { error: 'The supplied If-Version is stale.', code: VERSION_CONFLICT }
 *       500:
 *         description: |
 *           One of three cases: the record could not be read, so nothing was
 *           attempted; the update failed and rolled back, so nothing was
 *           committed; or the response projection failed after the update had
 *           committed. Only the last leaves a new stored version behind, so a
 *           retry with the old token would answer 409. Re-read the record
 *           first and retry with the version it reports.
 *
 *           A record that has reached its maximum annotation version cannot be
 *           annotated further and answers this response; contact the operator.
 *           Under heavy contention an update can also exceed its lock wait and
 *           answer this response; re-read the record and retry with its
 *           current version.
 *
 *           The response is sanitised and carries a correlation id.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;
  logger.info({ recordId: id }, 'Updating library record annotations');
  if (id.includes('\0')) {
    throw new NotFoundError('No such credential record.', 'NOT_FOUND');
  }

  try {
    // Read failures are separated here rather than in the catch below, because
    // by the time the catch sees a stored-shape error it can no longer tell a
    // record that could not be read from one whose update committed and whose
    // response then failed. GET keeps the same two apart.
    let existing;
    try {
      existing = await getLibraryRecordById(id, tenantId);
    } catch (error) {
      if (error instanceof LibraryRecordShapeError) {
        return sanitisedServerError(error, id, 'The library record could not be read for an annotation update');
      }
      throw error;
    }
    if (existing === null) {
      throw new NotFoundError('No such credential record.', 'NOT_FOUND');
    }
    if (existing.origin === LibraryRecordOrigin.NATIVE) {
      throw new ForbiddenError(NATIVE_ANNOTATION_MESSAGE, 'NATIVE_CREDENTIAL_NOT_ANNOTATABLE');
    }

    const expectedVersion = parseIfVersion(req);
    let body: UpdateLibraryAnnotationsRequest;
    try {
      body = await parseRequestBody(req, updateLibraryAnnotationsRequestSchema);
    } catch (error) {
      rethrowAsValidationFailed(error);
    }

    const { dateReceived, ...otherFields } = definedFields(body);
    const changes: LibraryRecordAnnotationChanges = {
      ...otherFields,
      ...(dateReceived !== undefined
        ? { dateReceived: dateReceived === null ? null : new Date(`${dateReceived}T00:00:00Z`) }
        : {}),
    };
    logger.info({ recordId: id, fields: Object.keys(changes) }, 'Library record annotation fields accepted');

    const result = await updateLibraryRecordAnnotations({
      recordId: id,
      tenantId,
      expectedVersion,
      changes,
    });
    if (result.outcome === 'missing') {
      logger.info({ recordId: id }, 'Library record disappeared before annotation update');
      throw new NotFoundError('No such credential record.', 'NOT_FOUND');
    }
    if (result.outcome === 'native') {
      throw new ForbiddenError(NATIVE_ANNOTATION_MESSAGE, 'NATIVE_CREDENTIAL_NOT_ANNOTATABLE');
    }
    if (result.outcome === 'version_conflict') {
      logger.info(
        { recordId: id, expectedVersion, currentVersion: result.currentVersion },
        'Library record annotation version conflict',
      );
      throw new ConflictError(VERSION_CONFLICT_MESSAGE, 'VERSION_CONFLICT');
    }

    const projected = toCredentialRecord(result.view);
    logger.info(
      { recordId: id, annotationVersion: projected.annotations?.annotationVersion, fields: Object.keys(changes) },
      'Library record annotations updated',
    );
    return NextResponse.json(projected);
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof ForbiddenError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError ||
      error instanceof PayloadTooLargeError
    ) {
      throw error;
    }
    // The shared mapper owns the database fault and logs it under its own
    // distinct message, which carries the correlation id but not the record.
    // This line is what makes the record reachable without that join.
    if (isDatabaseError(error)) {
      logger.warn({ recordId: id }, 'Library record annotation update hit a database error');
      throw error;
    }
    // The write transaction's own pre-write read met a stored shape the write
    // paths never produce, so it is committed corruption found before anything
    // was written. That is the same finding as the pre-check read above and
    // carries the same line. A shape error met by the post-write read-back is
    // converted to a write anomaly by the repository and never arrives here.
    if (error instanceof LibraryRecordShapeError) {
      return sanitisedServerError(error, id, 'The library record could not be read for an annotation update');
    }
    // A write anomaly is raised inside the repository's transaction and rolls
    // it back, so nothing was committed and no version advanced.
    if (error instanceof LibraryRecordWriteAnomalyError) {
      return sanitisedServerError(error, id, 'Library record annotation update failed and rolled back');
    }
    // Only a projection failure follows a committed update. The transaction
    // has already returned by the time the view is projected, so this is the
    // one branch whose caller may hold a stale version.
    if (error instanceof CredentialRecordProjectionError) {
      return sanitisedServerError(error, id, 'The library record annotation update could not be projected');
    }
    return sanitisedServerError(error, id, 'Library record annotation update failed');
  }
});
