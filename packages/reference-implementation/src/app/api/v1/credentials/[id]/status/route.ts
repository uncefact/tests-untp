import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { parseQueryParams } from '@/lib/api/validation';
import {
  readCredentialStatusQuerySchema,
  credentialStatusReadSchema,
} from '@/lib/api/request-schemas/credential-status';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
import { readCredentialStatus } from '@/lib/credentials/read-credential-status';

async function recodeValidation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowAsValidationFailed(error);
  }
}

/**
 * @swagger
 * /credentials/{id}/status:
 *   get:
 *     operationId: readCredentialStatus
 *     summary: Read issuer-owned credential status
 *     description: |
 *       Returns stored capture, attribution and entry facts. fresh=true additionally
 *       reads each entry from its pinned or attributed provider and returns observed
 *       and failures arrays. A live read writes nothing, advances no version and never
 *       clears pending intent. A successful response can contain per-entry failures.
 *     tags: [Credentials]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: The tenant-owned library record id, not the credential's external identifier.
 *       - in: query
 *         name: fresh
 *         schema: { type: boolean, default: false }
 *         description: When true, read each captured status entry from its attributed provider without changing stored state.
 *     responses:
 *       200:
 *         description: Stored facts, with separate observations and failures when fresh=true. Cache-Control is no-store.
 *         headers:
 *           Cache-Control:
 *             description: This status response is never cached.
 *             schema: { type: string, enum: [no-store] }
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialStatusRead'
 *       400:
 *         description: VALIDATION_FAILED for an invalid or repeated fresh parameter.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               repeatedFresh:
 *                 value: { error: 'fresh: repeated query parameter', code: VALIDATION_FAILED }
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         description: Forbidden when the authenticated principal has no resolvable tenant assignment, or EXTERNAL_CREDENTIAL_STATUS_NOT_MANAGEABLE for an external credential.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               externalCredential:
 *                 value: { error: 'External credential status is managed by its issuer.', code: EXTERNAL_CREDENTIAL_STATUS_NOT_MANAGEABLE }
 *       404:
 *         description: NOT_FOUND for an absent or foreign record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingCredential:
 *                 value: { error: 'No such credential record.', code: NOT_FOUND }
 *       500:
 *         description: RECORD_UNREADABLE or a sanitised database failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               unreadableCredential:
 *                 value: { error: 'The native credential record cannot be read. Contact the operator.', code: RECORD_UNREADABLE }
 */
export const GET = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;
  const { fresh } = await recodeValidation(() => parseQueryParams(new URL(req.url), readCredentialStatusQuerySchema));
  const result = await readCredentialStatus({ recordId: id, tenantId, fresh });
  // Keep the strict schema gate here because this read has a deliberately
  // narrower public projection than the credential status domain result.
  return NextResponse.json(credentialStatusReadSchema.parse(result), { headers: { 'Cache-Control': 'no-store' } });
});
