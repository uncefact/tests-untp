import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { parseIfVersion } from '@/lib/api/if-version';
import { parseRequestBody } from '@/lib/api/validation';
import { rethrowAsValidationFailed } from '@/lib/api/rethrow-as-validation-failed';
import { parseStatusPurpose, setCredentialStatusSchema } from '@/lib/api/request-schemas/credential-status';
import { setCredentialStatus } from '@/lib/credentials/set-credential-status';
import { requireStatusRecordVisible } from '@/lib/credentials/credential-status-context';

async function recodeValidation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowAsValidationFailed(error);
  }
}

/**
 * @swagger
 * /credentials/{id}/status/{purpose}:
 *   put:
 *     operationId: setCredentialStatus
 *     summary: Change an issuer-owned status entry
 *     description: |
 *       Requires a captured entry and an attributed issuing service. Only revocation
 *       and suspension are supported. Revocation cannot be cleared. Unknown body keys
 *       are ignored. A 200 means an error-free provider read confirmed the requested
 *       value and the observation was committed. An unchanged bit is not set again.
 *       Verification generations are unaffected. Read stored status after any uncertain
 *       persistence outcome; reconcile an unconfirmed provider write after its grace window.
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
 *         description: Decoded once; control characters are refused. The credential must carry this purpose.
 *       - in: header
 *         name: If-Version
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 2147483647 }
 *         description: Current status entry version. Stale requests are refused, never replayed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetCredentialStatusRequest'
 *     responses:
 *       200:
 *         description: The provider observation was committed.
 *         headers:
 *           Cache-Control:
 *             description: This status response is never cached.
 *             schema: { type: string, enum: [no-store] }
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialStatusObservation'
 *       400:
 *         description: |
 *           The tenant-scoped record lookup runs first, so an absent or foreign record
 *           answers 404 whatever the headers carry. INVALID_IF_VERSION then covers a
 *           missing or malformed If-Version header, and VALIDATION_FAILED covers an
 *           invalid body, purpose or validation raised by the status operation.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingIfVersion:
 *                 value: { error: 'If-Version header is required.', code: INVALID_IF_VERSION }
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
 *         description: NOT_FOUND for an absent or foreign record, refused before header and body validation; STATUS_ENTRY_NOT_FOUND for a purpose it does not carry.
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
 *         description: STATUS_METADATA_UNAVAILABLE, STATUS_IRREVERSIBLE, VERSION_CONFLICT, STATUS_OPERATION_IN_PROGRESS or STATUS_RECOVERY_REQUIRED. No provider set is dispatched.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               metadataUnavailable:
 *                 value: { error: 'Status metadata is unavailable. Ask the operator to run pnpm backfill:credential-status-entries, using --retry-failed for a retryable capture failure.', code: STATUS_METADATA_UNAVAILABLE }
 *               operationInProgress:
 *                 value: { error: 'A status change for purpose "revocation" is in progress. The requested operation to set it to true must wait for it to complete.', code: STATUS_OPERATION_IN_PROGRESS }
 *               recoveryRequired:
 *                 value: { error: 'A status change for purpose "revocation" remains unconfirmed. The requested operation to set it to true must be reconciled before another change.', code: STATUS_RECOVERY_REQUIRED }
 *       413:
 *         $ref: '#/components/responses/PayloadTooLargeResponse'
 *       422:
 *         description: STATUS_PURPOSE_UNSUPPORTED or STATUS_ENTRY_UNSUPPORTED. No provider set is dispatched.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               unsupportedPurpose:
 *                 value: { error: 'This status purpose cannot be changed by this service.', code: STATUS_PURPOSE_UNSUPPORTED }
 *       500:
 *         description: RECORD_UNREADABLE for malformed stored metadata, or a sanitised database failure before dispatch.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidDescriptor:
 *                 value: { error: 'The stored status descriptor is invalid. Contact the operator.', code: RECORD_UNREADABLE }
 *       502:
 *         description: VC_STATUS_RESPONSE_INVALID before a set, or VC_SERVICE_UNAVAILABLE for a definitive provider refusal. The owned intent is cleared.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidObservation:
 *                 value: { error: 'The status service returned an invalid observation. No status change was confirmed.', code: VC_STATUS_RESPONSE_INVALID }
 *       503:
 *         description: |
 *           STATUS_MUTATION_DISABLED, VC_SERVICE_UNAVAILABLE, STATUS_LIST_BUSY or
 *           STATUS_COORDINATION_UNAVAILABLE before dispatch. STATUS_OUTCOME_UNKNOWN
 *           keeps pending intent because a write may have applied. STATUS_OUTCOME_MISMATCH
 *           keeps intent and returns observed.value and observed.observedAt. STATUS_PROVIDER_CHANGED
 *           keeps intent when the provider identity changed. STATUS_PERSISTENCE_FAILED
 *           means the observation was not recorded by this request. STATUS_PERSISTENCE_UNCERTAIN
 *           means the commit acknowledgement was lost; read GET status before acting again.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               mutationDisabled:
 *                 value: { error: 'Status changes are not enabled on this deployment. Contact the operator.', code: STATUS_MUTATION_DISABLED }
 */
export const PUT = withTenantAuth(async (req, { tenantId, params }) => {
  const { id, purpose } = await params;
  await requireStatusRecordVisible(id, tenantId);
  const ifVersion = req.headers.get('If-Version');
  parseIfVersion(ifVersion);
  const body = await recodeValidation(() => parseRequestBody(req, setCredentialStatusSchema));
  const parsedPurpose = await recodeValidation(() => parseStatusPurpose(purpose));
  const observation = await recodeValidation(() =>
    setCredentialStatus({
      recordId: id,
      tenantId,
      purpose: parsedPurpose,
      value: body.value,
      ifVersion,
    }),
  );
  return NextResponse.json(observation, { headers: { 'Cache-Control': 'no-store' } });
});
