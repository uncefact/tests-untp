import { NextResponse } from 'next/server';
import { apiLogger } from '@/lib/api/logger';
import { parseRequestBody } from '@/lib/api/validation';
import { batchGetLibraryRequestSchema } from '@/lib/api/request-schemas/library';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { sanitisedServerError } from '@/lib/api/sanitised-server-error';
import {
  toCredentialRecord,
  toNativeCredentialRecord,
  type CredentialRecordResponse,
} from '@/lib/library/credential-record-projection';
import { LibraryRecordOrigin } from '@/lib/prisma/generated';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { batchGetLibraryRecords } from '@/lib/prisma/repositories/library-record.repository';

const logger = apiLogger.child({ route: '/api/v1/library/batch-get' });

/**
 * @swagger
 * /library/batch-get:
 *   post:
 *     operationId: batchGetLibraryRecords
 *     summary: Fetch multiple library records by id in one call
 *     description: |
 *       Returns the matching native and external credential records owned by
 *       the authenticated tenant. The response contains at most one row per
 *       id, in the order each id first appears in the request body. Missing,
 *       foreign-tenant and NUL-bearing ids are silently omitted.
 *
 *       Request validation runs before the id maximum is checked. The maximum
 *       counts ids as submitted, before duplicate removal, and is configurable
 *       by deployment with a default of 500. An over-limit request returns
 *       `BATCH_GET_LIMIT_EXCEEDED` and names the effective maximum; it is never
 *       truncated. The published schema has no fixed `maxItems` because the
 *       deployment may change the value.
 *
 *       Rows always use the keyless `CredentialRecord` shape. They never carry
 *       key material or a durable-copy storage location. Use
 *       `GET /api/v1/library/{id}` when either is required for one record.
 *       Every successful response, including an empty result, carries
 *       `Cache-Control: no-store`.
 *     tags:
 *       - Library
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BatchGetLibraryRequest'
 *     responses:
 *       200:
 *         description: Matching keyless records in first-appearance request order.
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *               enum: [no-store]
 *             description: Always no-store because library records are tenant-scoped data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CredentialRecord'
 *             examples:
 *               mixedRecords:
 *                 value:
 *                   data:
 *                     - id: record-external-1
 *                       origin: external
 *                       credential: { name: Example credential, credentialType: DPP, issuerName: Example issuer, issuerDid: did:web:issuer.example, subjectName: Example subject, subjectId: https://issuer.example/subject-1, validFrom: '2026-07-20T10:00:00Z', validUntil: null }
 *                       annotations: { annotationVersion: 1, displayName: Example credential, declaredCredentialType: DPP, dateReceived: '2026-07-30', notes: null }
 *                       organisationId: null
 *                       facilityId: null
 *                       productId: null
 *                       sourceUrl: https://issuer.example/credentials/1
 *                       sourceDigest: zQmExampleSourceDigest
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
 *                     - id: record-native-1
 *                       origin: native
 *                       credential: { name: Native example, credentialType: DCC, issuerName: Example issuer, issuerDid: did:web:issuer.example, subjectName: Native subject, subjectId: https://issuer.example/subject-2, validFrom: '2026-07-15T09:00:00Z', validUntil: null }
 *                       annotations: null
 *                       organisationId: null
 *                       facilityId: null
 *                       productId: null
 *                       sourceUrl: null
 *                       sourceDigest: null
 *                       resolverUri: null
 *                       issuedAt: '2026-07-15T09:00:00Z'
 *                       encrypted: false
 *                       hasKey: false
 *                       verification: { generation: 1, state: complete, requestedAt: '2026-07-15T09:00:00Z', completedAt: '2026-07-15T09:00:00Z', checks: { retrieval: not_run, decryption: not_run, digest: not_run, proof: pass, status: not_run, temporal: not_run, schemaConformance: not_run }, summary: verified }
 *                       currencyStatus: current
 *                       detailsStatus: EXTRACTED
 *                       detailsError: null
 *                       capabilities: { deletable: false, annotatable: false, verifiable: true }
 *                       warnings: []
 *                       createdAt: '2026-07-15T09:00:00Z'
 *                       updatedAt: '2026-07-15T09:00:00Z'
 *       400:
 *         description: A validation failure, or more ids than the deployment's configured maximum, counted as submitted before duplicate removal (`BATCH_GET_LIMIT_EXCEEDED`). Validation is checked before the limit and the request is never truncated.
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  const { ids } = await parseRequestBody(req, batchGetLibraryRequestSchema);
  // Exact duplicates keep first appearance. Postgres rejects NUL in text with
  // SQLSTATE 22021, so NUL-bearing ids cannot match a stored id and mirror the
  // detail route by being dropped before the database query.
  const selectedIds = [...new Set(ids.filter((id) => !id.includes('\0')))];
  if (selectedIds.length === 0) {
    return NextResponse.json({ data: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const records = await batchGetLibraryRecords({ tenantId, ids: selectedIds });
    const now = new Date(Date.now());
    const data: CredentialRecordResponse[] = records.map((view) =>
      view.origin === LibraryRecordOrigin.NATIVE
        ? toNativeCredentialRecord(view, { now })
        : toCredentialRecord(view, { now }),
    );
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (isDatabaseError(error)) throw error;
    return sanitisedServerError(
      error instanceof Error ? error : new Error(String(error)),
      logger,
      'The library records could not be fetched in a batch',
    );
  }
});
