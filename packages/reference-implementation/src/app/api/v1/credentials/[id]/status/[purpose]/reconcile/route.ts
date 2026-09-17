import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { parseRequestBody } from '@/lib/api/validation';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
import { parseStatusPurpose, reconcileCredentialStatusSchema } from '@/lib/api/request-schemas/credential-status';
import { reconcileCredentialStatus } from '@/lib/credentials/reconcile-credential-status';

async function recodeValidation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowAsValidationFailed(error);
  }
}

/**
 * @swagger
 * /credentials/{id}/status/{purpose}/reconcile:
 *   post:
 *     operationId: reconcileCredentialStatus
 *     summary: Record a status observation and resolve an uncertain change
 *     description: |
 *       Pending changes require the operation deadline plus recovery grace to pass.
 *       A changed provider requires acceptProviderChange: true after its identity is
 *       confirmed. With no pending change, this records an initial or later observation
 *       using the attributed service. It never sets a bit. Failed reads retain pending intent.
 *       Unknown body keys are ignored. A 200 records this observation only; a provider
 *       request accepted earlier can still apply later.
 *     tags: [Credentials]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: purpose
 *         required: true
 *         schema: { type: string, minLength: 1, maxLength: 255 }
 *         description: Decoded once, without control characters.
 *       - in: header
 *         name: If-Version
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 2147483647 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReconcileCredentialStatusRequest'
 *     responses:
 *       200:
 *         description: The observation was committed, the version advanced and any inspected pending intent cleared.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialStatusObservation'
 *       400:
 *         description: VALIDATION_FAILED for an invalid body, purpose or If-Version header.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingIfVersion:
 *                 value: { error: 'If-Version header is required.', code: VALIDATION_FAILED }
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
 *         description: NOT_FOUND or STATUS_ENTRY_NOT_FOUND. The latter names the requested purpose.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingCredential:
 *                 value: { error: 'No such credential record.', code: NOT_FOUND }
 *               missingPurpose:
 *                 value: { error: 'The credential has no status entry for purpose "suspension".', code: STATUS_ENTRY_NOT_FOUND }
 *       409:
 *         description: STATUS_METADATA_UNAVAILABLE, VERSION_CONFLICT or STATUS_OPERATION_IN_PROGRESS while the deadline plus grace is still live.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               operationInProgress:
 *                 value: { error: 'The status operation and its recovery grace window have not ended. Retry reconciliation later.', code: STATUS_OPERATION_IN_PROGRESS }
 *       413:
 *         $ref: '#/components/responses/PayloadTooLargeResponse'
 *       422:
 *         description: STATUS_ENTRY_UNSUPPORTED for management metadata the service cannot represent. The pending intent is unchanged and retrying will not help.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               unsupportedEntry:
 *                 value: { error: 'The status entry cannot be represented by this service. The pending intent is unchanged and retrying will not help.', code: STATUS_ENTRY_UNSUPPORTED }
 *       500:
 *         description: RECORD_UNREADABLE or a sanitised database failure before the observation.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidDescriptor:
 *                 value: { error: 'The stored status descriptor is invalid. Contact the operator.', code: RECORD_UNREADABLE }
 *       502:
 *         description: VC_STATUS_RESPONSE_INVALID for an invalid provider observation. The pending intent is unchanged and retrying will not help.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidObservation:
 *                 value: { error: 'The status service returned an invalid observation. No status change was confirmed. The pending intent is unchanged and retrying will not help.', code: VC_STATUS_RESPONSE_INVALID }
 *       503:
 *         description: VC_SERVICE_UNAVAILABLE retains any intent; STATUS_PROVIDER_CHANGED refuses changed identity; STATUS_PERSISTENCE_FAILED records nothing; STATUS_PERSISTENCE_UNCERTAIN requires GET status to discover the commit outcome.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               providerUnavailable:
 *                 value: { error: 'Reconciliation could not observe the status. The previous confirmed value and any pending intent are unchanged. Retry reconciliation later.', code: VC_SERVICE_UNAVAILABLE }
 */
export const POST = withTenantAuth(async (req, { tenantId, params }) => {
  const { id, purpose } = await params;
  const body = await recodeValidation(() => parseRequestBody(req, reconcileCredentialStatusSchema));
  const parsedPurpose = await recodeValidation(() => parseStatusPurpose(purpose));
  const observation = await recodeValidation(() =>
    reconcileCredentialStatus({
      recordId: id,
      tenantId,
      purpose: parsedPurpose,
      ifVersion: req.headers.get('If-Version'),
      ...body,
    }),
  );
  return NextResponse.json(observation, { headers: { 'Cache-Control': 'no-store' } });
});
