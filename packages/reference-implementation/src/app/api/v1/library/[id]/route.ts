import { NextResponse } from 'next/server';
import { NotFoundError, unexpectedErrorMessage } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { revealDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { CredentialRecordProjectionError, toCredentialRecordDetail } from '@/lib/library/credential-record-projection';
import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { getLibraryRecordById } from '@/lib/prisma/repositories/library-record.repository';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';

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
 * The 500 for every failure this route owns. The error is logged with the
 * record it happened on; no error in this chain carries key material, because
 * the decrypt failure is Node's own authentication error and the projection
 * and shape failures name rows, not values.
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
 *       it settles to `complete` or `failed`.
 *
 *       `storageUri` is the Reference Implementation's durable-copy location
 *       and is distinct from an external record's `sourceUrl`. An external
 *       record can have a storage URI while `decryptionKey` is null when it
 *       holds unopened ciphertext. A record with no durable copy yet returns
 *       all three custody fields as null.
 *
 *       `hasKey` and `decryptionKey` report the stored custody state as it is
 *       now. A later re-verification that proves the durable copy lost does
 *       not yet clear them, so a key can still be returned for a copy that no
 *       longer answers. That transition is tracked by
 *       uncefact/tests-untp#957.
 *
 *       For a native record, `verification` generation 1 is an issuance
 *       assertion rather than an executed run. `proof` reads `pass` because
 *       this service signed the artefact moments earlier, and no check was
 *       run. Generation 2 onward is executed. Every generation of an external
 *       record is executed.
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
 *                   verification: { generation: 1, state: failed, requestedAt: '2026-08-30T11:05:00.000Z', completedAt: '2026-08-30T11:05:02.000Z', checks: { retrieval: pass, decryption: fail, digest: not_run, proof: not_run, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: failed, failure: { code: DECRYPTION_REQUIRED, message: 'The fetched credential is encrypted and no decryption key was supplied; re-verify with a key to open it.', retryable: true } }
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
