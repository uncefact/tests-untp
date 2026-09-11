import { NextResponse } from 'next/server';
import { ForbiddenError, unexpectedErrorMessage } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { retiredRoute } from '@/lib/api/retired-route';
import { deleteNativeCredentialAndCopy } from '@/lib/credentials/delete-native-credential';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';

const logger = apiLogger.child({ module: 'credentials-id-route' });

const EXTERNAL_DELETE_MESSAGE = 'This id is an external library record; delete it with DELETE /api/v1/library/{id}.';

/**
 * @swagger
 * /credentials/{id}:
 *   get:
 *     operationId: getCredentialRetired
 *     summary: 'RETIRED: use GET /api/v1/library/{id}'
 *     deprecated: true
 *     description: |
 *       Retired with no deprecation window. Authentication and tenant
 *       resolution run before retirement. The supplied id is not looked up.
 *       Use GET /api/v1/library/{id} with the same credential record id.
 *       See the migration guide at `/docs/migration-guides/ri-v0.5`.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Credential record id. The retired route does not look it up.
 *     responses:
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       410:
 *         description: |
 *           This route has been retired. Use GET /api/v1/library/{id} instead.
 *           Returned after authentication and tenant resolution succeed.
 *         headers:
 *           Cache-Control:
 *             description: Prevents caching of the retirement response.
 *             schema:
 *               type: string
 *               enum: [no-store]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               retired:
 *                 value:
 *                   error: This route has been retired. Use GET /api/v1/library/{id} instead.
 *                   code: ROUTE_RETIRED
 *       500:
 *         description: 'The request could not be completed and the response body is sanitised.'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async () => retiredRoute('GET /api/v1/library/{id}'));

/**
 * @swagger
 * /credentials/{id}:
 *   delete:
 *     operationId: deleteCredential
 *     summary: Delete a credential this service issued
 *     description: |
 *       Deletes a native credential owned by the caller's tenant: the library
 *       record, its verification history and its issuance idempotency claim
 *       in one transaction, then the durable copy of the signed artefact at
 *       the storage instance, bucket and object id recorded at issuance.
 *       The lookup is tenant-scoped, so a record that exists only in another
 *       tenant, one already deleted and an id that never existed all answer
 *       the same idempotent 204. An external library record in the caller's
 *       tenant is the only record-level 403; it is deleted through
 *       DELETE /api/v1/library/{id} instead.
 *
 *       Deleting a credential does not revoke it. A copy already shared with
 *       a verifier stays verifiable against its status list; revocation on
 *       delete is planned for a later release. Identifier links published to
 *       the Identity Resolver for this credential are not removed and will
 *       resolve to a missing artefact.
 *
 *       The durable-copy deletion runs after the transaction has committed
 *       and never changes the response. A copy that cannot be removed (an
 *       unreachable storage service, a refused delete, or a credential issued
 *       before the storage coordinates were recorded) is left in place and
 *       reported in the operator log with its coordinates.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The credential record id returned by issuance.
 *     responses:
 *       204:
 *         description: |
 *           Idempotent success with no response body: the credential was
 *           deleted by this call, was deleted earlier, never existed, or
 *           exists only in another tenant. A durable-copy cleanup failure
 *           does not alter this response.
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         description: >-
 *           Forbidden. Either of: the authenticated principal has no
 *           resolvable tenant assignment; or the id names an external library
 *           record, which this route does not delete.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               noTenantForUser:
 *                 summary: The authenticated user maps to no tenant
 *                 value: { error: 'No tenant found for user' }
 *               externalRecord:
 *                 value: { error: 'This id is an external library record; delete it with DELETE /api/v1/library/{id}.', code: EXTERNAL_RECORD_NOT_DELETABLE_HERE }
 *       500:
 *         description: |
 *           The transaction failed and was rolled back, or its commit outcome
 *           is uncertain. The response is sanitised and safe to repeat.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  if (id.includes('\0')) {
    logger.info({ tenantId, reason: 'nul_id' }, 'Credential delete treated as missing');
    return new NextResponse(null, { status: 204 });
  }

  let result;
  try {
    result = await deleteNativeCredentialAndCopy({ recordId: id, tenantId });
  } catch (error) {
    if (isDatabaseError(error)) {
      logger.warn({ recordId: id, tenantId }, 'Credential delete hit a database error');
      throw error;
    }
    logger.error({ error: safeError(error), recordId: id }, 'Credential delete failed and rolled back');
    return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
  }

  if (result.outcome === 'missing') {
    logger.info({ recordId: id, tenantId }, 'Credential delete missed');
    return new NextResponse(null, { status: 204 });
  }
  if (result.outcome === 'external') {
    throw new ForbiddenError(EXTERNAL_DELETE_MESSAGE, 'EXTERNAL_RECORD_NOT_DELETABLE_HERE');
  }

  // The use case has already committed the delete and finished its
  // best-effort durable-copy cleanup, whose outcome never changes this response.
  return new NextResponse(null, { status: 204 });
});
