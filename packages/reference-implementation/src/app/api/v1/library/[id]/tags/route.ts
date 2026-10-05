import { NextResponse } from 'next/server';
import { ConflictError, NotFoundError, PayloadTooLargeError } from '@/lib/api/errors';
import { parseIfVersion } from '@/lib/api/if-version';
import { apiLogger } from '@/lib/api/logger';
import { parseRequestBody, ValidationError } from '@/lib/api/validation';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
import { sanitisedServerError } from '@/lib/api/sanitised-server-error';
import { replaceLibraryTagsRequestSchema, type ReplaceLibraryTagsRequest } from '@/lib/api/request-schemas/library';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import {
  CredentialRecordProjectionError,
  toCredentialRecord,
  toNativeCredentialRecord,
} from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import {
  getLibraryRecordById,
  LibraryRecordWriteAnomalyError,
  replaceLibraryRecordTags,
} from '@/lib/prisma/repositories/library-record.repository';

const logger = apiLogger.child({ route: '/api/v1/library/[id]/tags' });

const NOT_FOUND_MESSAGE = 'No such credential record.';
const VERSION_CONFLICT_MESSAGE = 'The supplied If-Version is stale.';

/**
 * @swagger
 * /library/{id}/tags:
 *   put:
 *     operationId: replaceLibraryRecordTags
 *     summary: Replace the tags on a library record
 *     description: |
 *       Replaces the tenant's tags on one library record of either origin,
 *       native or external, with the full list in the body. Tags are a second
 *       kind of tenant annotation, separate from the recipient `annotations`
 *       an external record carries: they apply to both origins and have their
 *       own version, `tagVersion`, so a tag replacement and an annotation
 *       update never invalidate each other's `If-Version`. The credential, its
 *       durable copy, the recipient annotations and verification are never
 *       changed.
 *
 *       The list is stored and returned in the order given. An empty list
 *       clears the tags. Every successful request advances `tagVersion` by
 *       one and moves the record's `updatedAt`, including one that sends the
 *       list already stored. A stale `If-Version` returns 409 and changes
 *       nothing.
 *
 *       The tenant-scoped record lookup runs first, so a missing or foreign
 *       id returns the same 404 whatever the header and body hold. The
 *       `If-Version` header is validated next, before the body, so a request
 *       whose header and body are both invalid reports
 *       `400 INVALID_IF_VERSION`. The body is validated before the version is
 *       compared, so an invalid list sent with a stale version reports
 *       `400 VALIDATION_FAILED` rather than 409.
 *
 *       A projection failure after the transaction commits is answered as a
 *       sanitised 500. The replacement is already committed in that case;
 *       re-read the record and use its new `tagVersion` before retrying.
 *     tags:
 *       - Library
 *     parameters:
 *       - $ref: '#/components/parameters/LibraryRecordId'
 *       - in: header
 *         name: If-Version
 *         required: true
 *         description: |
 *           The record's current tagVersion. Whitespace, leading zeroes and a
 *           leading plus sign are accepted. An absent header returns
 *           `400 INVALID_IF_VERSION` with the message
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
 *             $ref: '#/components/schemas/ReplaceLibraryTagsRequest'
 *     responses:
 *       200:
 *         description: The keyless credential record with its replaced tags.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialRecord'
 *             examples:
 *               externalTagsReplaced:
 *                 summary: An external record's tags replaced; its annotation version is unchanged
 *                 value:
 *                   id: clw0ext3rn4lannotat000001
 *                   origin: external
 *                   credential: { name: Recycled Content DCC, credentialType: DCC, issuerName: Supplier Ltd, issuerDid: 'did:web:supplier.example', subjectName: Cathode Batch 42, subjectId: 'https://supplier.example/batches/42', validFrom: '2026-08-30T10:15:00.000Z', validUntil: null }
 *                   annotations: { annotationVersion: 1, displayName: Recycled content DCC from Supplier Ltd, declaredCredentialType: DCC, dateReceived: '2026-08-30', notes: null }
 *                   tags: [cab-portal, audit-2026]
 *                   tagVersion: 2
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
 *                   status: null
 *                   lifecycle: null
 *                   capabilities: { deletable: true, annotatable: true, taggable: true, verifiable: true, statusManageable: false }
 *                   warnings: []
 *                   createdAt: '2026-08-30T10:20:00.000Z'
 *                   updatedAt: '2026-09-09T10:20:00.000Z'
 *               nativeTagsCleared:
 *                 summary: A native record's tags cleared with an empty list
 *                 value:
 *                   id: clw0n4t1v3encrypted000001
 *                   origin: native
 *                   credential: { name: Battery Pack DPP, credentialType: DPP, issuerName: Acme Battery Co, issuerDid: 'did:web:acme.example', subjectName: Battery Pack Model X, subjectId: 'https://acme.example/products/battery-x', validFrom: '2026-07-15T09:00:00.000Z', validUntil: '2029-07-15T09:00:00.000Z' }
 *                   annotations: null
 *                   tags: []
 *                   tagVersion: 3
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
 *                   status: { capture: PENDING, statusCaptureError: null, entries: [] }
 *                   lifecycle: unknown
 *                   capabilities: { deletable: true, annotatable: false, taggable: true, verifiable: true, statusManageable: false }
 *                   warnings: []
 *                   createdAt: '2026-07-15T09:00:00.000Z'
 *                   updatedAt: '2026-09-10T08:00:00.000Z'
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
 *               tagsMissing:
 *                 value: { error: 'tags: is required', code: VALIDATION_FAILED }
 *               tagFormat:
 *                 value: { error: 'tags.0: must be lowercase letters and digits, with single hyphens between them', code: VALIDATION_FAILED }
 *               duplicateTag:
 *                 value: { error: 'tags.2: must not repeat a tag; duplicates tags.0', code: VALIDATION_FAILED }
 *               malformedJsonBody:
 *                 value: { error: 'Invalid JSON body', code: VALIDATION_FAILED }
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
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
 *           attempted; the replacement failed and rolled back, so nothing was
 *           committed; or the response projection failed after the
 *           replacement had committed. Only the last leaves a new stored
 *           version behind, so a retry with the old token would answer 409.
 *           Re-read the record first and retry with the version it reports.
 *
 *           Under heavy contention a replacement can also exceed its lock wait
 *           and answer this response; re-read the record and retry with its
 *           current version.
 *
 *           The response is sanitised and carries a correlation id.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const PUT = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;
  const log = logger.child({ recordId: id });
  log.info('Replacing library record tags');
  if (id.includes('\0')) {
    throw new NotFoundError(NOT_FOUND_MESSAGE, 'NOT_FOUND');
  }

  try {
    const existing = await getLibraryRecordById(id, tenantId);
    if (existing === null) {
      throw new NotFoundError(NOT_FOUND_MESSAGE, 'NOT_FOUND');
    }

    const expectedVersion = parseIfVersion(req.headers.get('If-Version'));
    let body: ReplaceLibraryTagsRequest;
    try {
      body = await parseRequestBody(req, replaceLibraryTagsRequestSchema);
    } catch (error) {
      rethrowAsValidationFailed(error);
    }
    log.info({ expectedVersion, tagCount: body.tags.length }, 'Library record tag list accepted');

    const result = await replaceLibraryRecordTags({ recordId: id, tenantId, expectedVersion, tags: body.tags });
    if (result.outcome === 'missing') {
      log.info('Library record disappeared before tag replacement');
      throw new NotFoundError(NOT_FOUND_MESSAGE, 'NOT_FOUND');
    }
    if (result.outcome === 'version_conflict') {
      log.info({ expectedVersion, currentVersion: result.currentVersion }, 'Library record tag version conflict');
      throw new ConflictError(VERSION_CONFLICT_MESSAGE, 'VERSION_CONFLICT');
    }

    const projected =
      result.view.origin === LibraryRecordOrigin.NATIVE
        ? toNativeCredentialRecord(result.view)
        : toCredentialRecord(result.view);
    log.info({ tagVersion: projected.tagVersion, tagCount: projected.tags.length }, 'Library record tags replaced');
    return NextResponse.json(projected);
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError ||
      error instanceof PayloadTooLargeError
    ) {
      throw error;
    }
    // The shared mapper owns the database fault and logs it without the
    // record, so this line is what makes the record reachable.
    if (isDatabaseError(error)) {
      log.warn('Library record tag replacement hit a database error');
      throw error;
    }
    // Committed corruption met by the pre-check read or by the write
    // transaction's own pre-write read, before anything was written. A
    // replacement that committed and whose response then failed arrives as a
    // projection error instead.
    if (error instanceof LibraryRecordShapeError) {
      return sanitisedServerError(error, log, 'The library record could not be read for a tag replacement');
    }
    // Raised inside the repository's transaction, which rolls back, so no
    // version advanced.
    if (error instanceof LibraryRecordWriteAnomalyError) {
      return sanitisedServerError(error, log, 'Library record tag replacement failed and rolled back');
    }
    // The only failure that follows a committed replacement.
    if (error instanceof CredentialRecordProjectionError) {
      return sanitisedServerError(error, log, 'The library record tag replacement could not be projected');
    }
    return sanitisedServerError(
      error instanceof Error ? error : new Error(String(error)),
      log,
      'Library record tag replacement failed',
    );
  }
});
