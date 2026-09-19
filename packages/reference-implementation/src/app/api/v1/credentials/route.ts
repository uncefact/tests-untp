import { TextDecoder } from 'node:util';
import { NextResponse } from 'next/server';
import { parseRequestBody } from '@/lib/api/validation';
import { ConflictError } from '@/lib/api/errors';
import {
  IDEMPOTENCY_KEY_HELD_ELSEWHERE_MESSAGE,
  digestRequestBody,
  parseIdempotencyKeyHeader,
  throwIdempotencyClassification,
} from '@/lib/api/idempotency';
import { readRequestBytes } from '@/lib/api/request-body';
import { credentialIssueRequestSchema } from '@/lib/api/request-schemas/credential';
import { IdempotencyOperation } from '@/lib/prisma/generated';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { retiredRoute } from '@/lib/api/retired-route';
import { apiLogger } from '@/lib/api/logger';
import { issueCredentialRequest, type CredentialWarning } from '@/lib/credentials/issue-credential-request';
import { IdempotencyClaimLostError } from '@/lib/prisma/repositories/idempotency-key.repository';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  findIdempotencyKey,
  releaseIdempotencyKey,
} from '@/lib/prisma/repositories';
import { StatusListMutexBusyError, StatusListMutexTimeoutError } from '@/lib/services/status-list-mutex';
import { ServiceError } from '@uncefact/untp-ri-services';
import { getOrMintCorrelationId } from '@uncefact/untp-ri-services/logging';

const logger = apiLogger.child({ route: '/api/v1/credentials' });

function idempotencyResponseNotRecordedWarning(): CredentialWarning {
  return {
    code: 'IDEMPOTENCY_RESPONSE_NOT_RECORDED',
    message:
      'The credential was issued and a retry with this key returns it, but the warnings on this response may not be repeated.',
    remediation: 'A retry with this key returns this credential. The warnings on this response may differ.',
  };
}

function idempotencyResponseUnreadableWarning(): CredentialWarning {
  return {
    code: 'IDEMPOTENCY_RESPONSE_UNREADABLE',
    message:
      'The credential was issued by an earlier request with this key, but the response recorded for it could not be read, so any warnings from that response are not repeated here.',
    remediation: `The credential itself is unaffected. Quote correlation ID ${getOrMintCorrelationId()} to your operator, who can find the cause in the logs.`,
  };
}

function issuanceReplayResponse(replay: { recordId: string; responseBody: unknown; responseBodyUnreadable?: true }) {
  const response: Record<string, unknown> = { credentialId: replay.recordId };
  const warnings = Array.isArray(replay.responseBody) ? [...replay.responseBody] : [];
  if (replay.responseBodyUnreadable) {
    warnings.push(idempotencyResponseUnreadableWarning());
  }
  if (warnings.length > 0) {
    response.warnings = warnings;
  }
  if (
    warnings.some(
      (warning) =>
        typeof warning === 'object' &&
        warning !== null &&
        (warning as { code?: unknown }).code === 'STATUS_CAPTURE_FAILED',
    )
  ) {
    response.statusCaptureFailed = true;
  }
  return NextResponse.json(response, { status: 201 });
}

function issuanceIdempotencyInput(tenantId: string, key: string, bodyDigest: string) {
  return { tenantId, operation: IdempotencyOperation.CREDENTIAL_ISSUE, key, bodyDigest };
}

/**
 * Compare-and-set of the final response. A lost race re-reads the winner's
 * body so this caller never returns warnings that disagree with the row.
 * A save failure must not fail the request: the credential already exists,
 * so releasing the key would let a retry mint a second one (#954). The
 * caller is told via `IDEMPOTENCY_RESPONSE_NOT_RECORDED`.
 */
async function completeIssuanceIdempotencyKeyOrReplay(input: {
  claimId: string;
  credentialId: string;
  warnings: CredentialWarning[];
  tenantId: string;
  idempotencyKey: string;
  bodyDigest: string;
}): Promise<ReturnType<typeof NextResponse.json> | undefined> {
  try {
    const { applied } = await completeIdempotencyKey({
      claimId: input.claimId,
      recordId: input.credentialId,
      responseBody: input.warnings,
    });
    if (!applied) {
      const winner = await findIdempotencyKey(
        issuanceIdempotencyInput(input.tenantId, input.idempotencyKey, input.bodyDigest),
      );
      if (winner.outcome === 'replay') {
        return issuanceReplayResponse(winner);
      }
      logger.warn(
        { credentialId: input.credentialId, idempotencyKey: input.idempotencyKey, claimId: input.claimId },
        'The Idempotency-Key was already finalised but its stored response could not be re-read',
      );
      input.warnings.push(idempotencyResponseNotRecordedWarning());
    }
  } catch (error) {
    logger.error(
      { err: error, credentialId: input.credentialId, idempotencyKey: input.idempotencyKey },
      'Failed to record the Idempotency-Key final response after the credential was issued',
    );
    input.warnings.push(idempotencyResponseNotRecordedWarning());
  }
  return undefined;
}

/**
 * @swagger
 * /credentials:
 *   post:
 *     summary: Issue a verifiable credential
 *     description: |
 *       Validates a credential payload via JSON Schema and JSON-LD expansion,
 *       verifies that the issuer DID belongs to the authenticated tenant or is
 *       a system default DID, signs it, stores the enveloped credential
 *       (optionally encrypted), optionally publishes it to the Identity
 *       Resolver, links it to its primary entity, and returns the credential ID.
 *       When statusPurposes is omitted, the deployment's CREDENTIAL_STATUS_DEFAULT_PURPOSES
 *       setting applies, with the built-in default of revocation when unset.
 *       One purpose is allowed by default because UNTP v0.7.0 schemas accept
 *       one credentialStatus object. Set CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED=true
 *       to issue a credential with multiple purposes.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *         description: >-
 *           A non-blank string of at most 255 characters after trimming,
 *           using only printable ASCII. Keys are scoped to the authenticated
 *           tenant. A retry while the original is still running, including
 *           while it publishes, is 409. Once the original has delivered its
 *           response, the same key and body replay it exactly, warnings
 *           included. If the original never delivered a response, a retry
 *           after the configured window replays the credential it recorded,
 *           or issues afresh only when no credential was recorded. A key
 *           whose credential was later removed is free again.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CredentialIssueRequest'
 *     responses:
 *       201:
 *         description: >-
 *           Credential issued. When publishing was requested and could not
 *           complete, the credential is still returned and a warning names the
 *           unmet prerequisite with a remediation; publishing never fails
 *           issuance.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialIssueResponse'
 *       400:
 *         description: >-
 *           Validation error. Request-shape failures name the offending field
 *           (missing or mistyped credentialPayload, credentialType, version,
 *           storageOptions, or publishingOptions, including a malformed
 *           verification URL or hreflang entry; unknown body fields are
 *           ignored). A caller-supplied credentialPayload.credentialStatus is
 *           refused with CREDENTIAL_STATUS_NOT_ACCEPTED. An invalid
 *           Idempotency-Key header (blank, longer than
 *           255 characters after trimming, or containing a character outside
 *           printable ASCII) is a 400 that names the header. An unknown data
 *           model (credentialType and version pair)
 *           and an issuer DID not registered to the tenant are also 400s.
 *           More than one statusPurposes entry is refused by default because
 *           UNTP v0.7.0 schemas accept one credentialStatus object. Set
 *           CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED=true to enable multiple purposes.
 *           Payload-validation failures carry
 *           a `code`: `SCHEMA_DOCUMENT_INVALID` or `JSONLD_DOCUMENT_INVALID`
 *           mean the payload itself is invalid and the message says what to
 *           fix; `SCHEMA_FETCH_FAILED` or `JSONLD_CONTEXT_FETCH_FAILED` mean
 *           a remote schema or `@context` could not be fetched or used,
 *           which reflects an upstream or configuration condition rather
 *           than a payload fault (the schema message names the schema URL;
 *           the context message names the failing `@context` URL where one
 *           was recorded, and carries the HTTP status or timeout where one
 *           applies).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               multipleStatusPurposesDisabled:
 *                 summary: Multiple status purposes are disabled
 *                 value:
 *                   error: 'statusPurposes: only one status purpose can be issued while CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED is false'
 *                   code: VALIDATION_FAILED
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Service instance not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               serviceInstanceNotFound:
 *                 summary: The requested service instance was not found
 *                 value:
 *                   error: 'Service instance not found: service-instance-1'
 *                   code: SERVICE_INSTANCE_NOT_FOUND
 *       409:
 *         description: >-
 *           Either a request with this Idempotency-Key is still being
 *           processed, or another request now holds the key. Retry to
 *           receive the result. The body carries `IDEMPOTENCY_KEY_IN_FLIGHT`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               stillProcessing:
 *                 summary: The original request is still running
 *                 value:
 *                   error: A request with this Idempotency-Key is still being processed. Retry shortly.
 *                   code: IDEMPOTENCY_KEY_IN_FLIGHT
 *               heldElsewhere:
 *                 summary: The key was reclaimed by another request
 *                 value:
 *                   error: Another request now holds this Idempotency-Key. Retry to receive that request's result.
 *                   code: IDEMPOTENCY_KEY_IN_FLIGHT
 *       422:
 *         description: This Idempotency-Key was already used with a different request body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               keyReusedWithDifferentBody:
 *                 value:
 *                   error: This Idempotency-Key was already used with a different request body.
 *                   code: IDEMPOTENCY_KEY_MISMATCH
 *       503:
 *         description: >-
 *           Status-list coordination could not complete, so nothing was
 *           issued. Retry shortly. `STATUS_LIST_BUSY` means the wait for the
 *           status-list mutex expired or coordination capacity was
 *           unavailable. `STATUS_LIST_LOCK_LOST` means the lock was lost
 *           before the provider call completed, in which case a status entry
 *           may already have been minted without a credential to carry it.
 *           Neither response exposes the internal serialisation key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               statusListBusy:
 *                 summary: The credential status service could not accept the issuance yet
 *                 value:
 *                   error: The credential status service is busy. Retry shortly.
 *                   code: STATUS_LIST_BUSY
 *               statusListLockLost:
 *                 summary: The status-list lock was lost during issuance
 *                 value:
 *                   error: The status list lock was lost before the provider call completed. Retry the request.
 *                   code: STATUS_LIST_LOCK_LOST
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

export const POST = withTenantAuth(async (req, { tenantId }) => {
  const idempotencyKey = parseIdempotencyKeyHeader(req);
  const requestBytes = await readRequestBytes(req);
  const bodyDigest = await digestRequestBody(requestBytes);
  const rawBody = new TextDecoder().decode(requestBytes);

  if (idempotencyKey !== undefined) {
    const existing = await findIdempotencyKey(issuanceIdempotencyInput(tenantId, idempotencyKey, bodyDigest));
    if (existing.outcome === 'mismatch' || existing.outcome === 'in-flight') {
      throwIdempotencyClassification(existing.outcome);
    }
    if (existing.outcome === 'replay') {
      return issuanceReplayResponse(existing);
    }
  }

  logger.info('Parsing and validating request body');
  const body = await parseRequestBody(
    {
      json: async () => JSON.parse(rawBody),
    },
    credentialIssueRequestSchema,
  );

  let claimId: string | undefined;
  if (idempotencyKey !== undefined) {
    const claim = await claimIdempotencyKey(issuanceIdempotencyInput(tenantId, idempotencyKey, bodyDigest));
    if (claim.outcome === 'mismatch' || claim.outcome === 'in-flight') {
      throwIdempotencyClassification(claim.outcome);
    }
    if (claim.outcome === 'replay') {
      return issuanceReplayResponse(claim);
    }
    claimId = claim.claimId;
  }

  let result: Awaited<ReturnType<typeof issueCredentialRequest>>;
  try {
    result = await issueCredentialRequest({
      tenantId,
      body,
      ...(claimId !== undefined ? { idempotencyClaimId: claimId } : {}),
    });
  } catch (error) {
    if (error instanceof StatusListMutexBusyError || error instanceof StatusListMutexTimeoutError) {
      const busy = error instanceof StatusListMutexBusyError;
      logger.warn(
        {
          err: error,
          ...(error.cause === undefined ? {} : { cause: error.cause }),
          tenantId,
        },
        busy
          ? 'Credential issuance could not acquire status-list coordination capacity'
          : 'Credential issuance could not acquire the status-list mutex',
      );
      throw new ServiceError(
        busy
          ? 'The credential status service is busy. Retry shortly.'
          : "Another issuance is currently updating this credential's status list. Retry shortly.",
        'STATUS_LIST_BUSY',
        503,
        undefined,
        error,
      );
    }
    if (error instanceof IdempotencyClaimLostError) {
      throw new ConflictError(IDEMPOTENCY_KEY_HELD_ELSEWHERE_MESSAGE, 'IDEMPOTENCY_KEY_IN_FLIGHT');
    }
    if (claimId !== undefined) {
      try {
        const { applied } = await releaseIdempotencyKey({ claimId });
        if (!applied) {
          logger.warn({ claimId, idempotencyKey }, 'Issuance failed but the Idempotency-Key claim was no longer owned');
        }
      } catch (releaseError) {
        logger.error({ err: releaseError, idempotencyKey }, 'Failed to release issuance idempotency key');
      }
    }
    throw error;
  }

  if (claimId !== undefined) {
    const bodyWarnings: CredentialWarning[] = result.body.warnings ?? [];
    const winnerResponse = await completeIssuanceIdempotencyKeyOrReplay({
      claimId,
      credentialId: result.body.credentialId,
      warnings: bodyWarnings,
      tenantId,
      idempotencyKey: idempotencyKey as string,
      bodyDigest,
    });
    if (winnerResponse !== undefined) {
      return winnerResponse;
    }
    if (bodyWarnings.length > 0) result.body.warnings = bodyWarnings;
  }

  return NextResponse.json(result.body, { status: result.status });
});

/**
 * @swagger
 * /credentials:
 *   get:
 *     operationId: listCredentialsRetired
 *     summary: 'RETIRED: use GET /api/v1/library'
 *     deprecated: true
 *     description: |
 *       Retired with no deprecation window. Authentication and tenant
 *       resolution run before retirement. Query parameters do not change
 *       the retirement response. Use GET /api/v1/library.
 *       See the migration guide at `/docs/migration-guides/ri-v0.5`.
 *     tags:
 *       - Credentials
 *     responses:
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       410:
 *         description: |
 *           This route has been retired. Use GET /api/v1/library instead.
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
 *                   error: This route has been retired. Use GET /api/v1/library instead.
 *                   code: ROUTE_RETIRED
 *       500:
 *         description: 'The request could not be completed and the response body is sanitised.'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async () => retiredRoute('GET /api/v1/library'));
