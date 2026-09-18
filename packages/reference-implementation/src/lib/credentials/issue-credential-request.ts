import { ValidationError, assertPublicUrl, assertHttpUrl } from '@/lib/api/validation';
import { CoreCredentialType } from '@/lib/prisma/generated';
import { getDidByDid, updateCredentialPublished } from '@/lib/prisma/repositories';
import { resolveAppUrl, buildVerifyUrl } from '@/lib/config/app-url.config';
import { readFetchAllowPrivateUrls } from '@/lib/config/credential-fetch.config';
import { resolveDataModel } from '@/lib/credentials/resolve-data-model';
import { validateCredentialPayload } from '@/lib/credentials/validate-credential-payload';
import { validateConformityClaimAtIssuance } from '@/lib/credentials/validate-conformity-claim-at-issuance';
import { issueCredential } from '@/lib/credentials/issue-credential';
import { coreCredentialTypeOf } from '@/lib/library/core-credential-type';
import { schemaLoader } from '@/lib/credentials/schema-loader';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { resolvePublishTarget } from '@/lib/credentials/resolve-publish-target';
import { apiLogger } from '@/lib/api/logger';
import { getOrMintCorrelationId } from '@uncefact/untp-ri-services/logging';
import { buildPublishLinks, IdrPublishError } from '@uncefact/untp-ri-services';
import type { CredentialPayload, ExtractedRefs, StorageRecord } from '@uncefact/untp-ri-services';
import type { CredentialIssueRequest } from '@/lib/api/request-schemas/credential';
import { readStatusMultiplePurposesEnabled } from '@/lib/config/credential-status.config';
import {
  CREDENTIAL_STATUS_NOT_ACCEPTED_MESSAGE,
  credentialIssueRequestSchema,
} from '@/lib/api/request-schemas/credential';

export type CredentialWarning = {
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
  remediation?: string;
  pointer?: string;
};

export type IssueCredentialRequestInput = {
  tenantId: string;
  body: CredentialIssueRequest;
  idempotencyClaimId?: string;
  /**
   * Runs immediately before the external credential issuance effect begins, after request, issuer and service checks.
   * It is a checkpoint boundary for callers and must not perform issuance or alter the request result.
   */
  onDispatch?: () => void;
};

export type IssueCredentialRequestResult = {
  status: 201;
  body: { credentialId: string; warnings?: CredentialWarning[] };
};

const logger = apiLogger.child({ module: 'issue-credential-request' });

/**
 * The core credential type a resolved data model stands for. That name is
 * always one the bridge registry knows today, so a miss means the registry
 * and the core-type vocabulary have drifted apart. The record is still
 * written, with its core kind unknown, and the operator is told why.
 */
function resolveCoreCredentialType(coreDataModelType: string): CoreCredentialType | null {
  const coreCredentialType = coreCredentialTypeOf(coreDataModelType);
  if (coreCredentialType === undefined) {
    logger.warn(
      { coreDataModelType },
      'Core data model type is not a known core credential type; recording no core kind',
    );
    return null;
  }
  return coreCredentialType;
}

/**
 * Default human verification link: this RI's own verify page, built from the
 * boot-validated RI_APP_URL (see instrumentation.node.ts). Used when a caller
 * requests publishing without an explicit publishingOptions.humanVerificationUrl.
 */
function defaultHumanVerificationUrl(): string {
  return buildVerifyUrl(resolveAppUrl());
}

type PublishIssuedCredentialInput = {
  publishingOptions: NonNullable<import('zod').infer<typeof credentialIssueRequestSchema>['publishingOptions']>;
  refs: ExtractedRefs | undefined;
  tenantId: string;
  credentialId: string;
  warnings: CredentialWarning[];
  storageResponse: StorageRecord;
  dataModel: { name: string };
  primaryEntity: { entityDescription?: string | null; entityName?: string | null };
  machineVerificationUrl: string | undefined;
  effectiveHumanVerificationUrl: string | undefined;
};

async function publishIssuedCredential({
  publishingOptions,
  refs,
  tenantId,
  credentialId,
  warnings,
  storageResponse,
  dataModel,
  primaryEntity,
  machineVerificationUrl,
  effectiveHumanVerificationUrl,
}: PublishIssuedCredentialInput): Promise<void> {
  if (publishingOptions.publish !== true || !refs) return;

  // Publishing resolves its target from the credential's own identifier
  // (ADR-044): the scheme, registrar and IDR instance all hang off
  // Identifier, so a missing master-data record no longer decides whether a
  // credential is discoverable. Every failure below names the unmet
  // prerequisite and what the caller does about it, and nothing throws: the
  // credential exists by this point, so a caller who loses the response
  // loses the id of a credential that was signed and stored.
  let resolution: Awaited<ReturnType<typeof resolvePublishTarget>>;
  try {
    resolution = await resolvePublishTarget(refs, tenantId, publishingOptions.identifierSchemeId);
  } catch (error) {
    logger.error({ err: error, credentialId }, 'Could not resolve the publish target');
    resolution = { outcome: 'unavailable' };
  }

  if (resolution.outcome === 'ambiguous') {
    warnings.push({
      code: 'PUBLISH_IDENTIFIER_AMBIGUOUS',
      message: `Publishing was requested but the identifier "${resolution.value}" exists under more than one scheme.`,
      remediation: `Set publishingOptions.identifierSchemeId to the scheme you want to publish under. Candidates: ${resolution.candidates
        .map((candidate) => `${candidate.schemeName} (${candidate.schemeId})`)
        .join(', ')}.`,
    });
  } else if (resolution.outcome === 'not-found') {
    warnings.push({
      code: 'PUBLISH_IDENTIFIER_UNKNOWN',
      message: `Publishing was requested but no identifier matching "${resolution.value}" is registered for this tenant.`,
      remediation: 'Register the identifier under an identifier scheme, then issue the credential again.',
    });
  } else if (resolution.outcome === 'no-reference') {
    warnings.push({
      code: 'PUBLISH_REFERENCE_MISSING',
      message: 'Publishing was requested but the credential payload carries no identifier to publish under.',
      remediation:
        "Check that the credential's subject carries the identifier fields its data model defines, such as a registeredId on the party or product.",
    });
  } else if (resolution.outcome === 'unavailable') {
    warnings.push({
      code: 'PUBLISH_TARGET_UNRESOLVED',
      message: "Publishing was requested but the credential's identifier could not be looked up.",
      remediation:
        'The credential was issued. Ask your operator to check the service, then issue again if you need it published.',
    });
  } else if (resolution.outcome === 'incomplete') {
    warnings.push({
      code: 'PUBLISH_SCHEME_INCOMPLETE',
      message: `Publishing was requested but the identifier "${resolution.value}" belongs to a scheme without both a primary key and a registrar namespace.`,
      remediation:
        'Give the identifier scheme a primary key, and its registrar a namespace, then issue the credential again.',
    });
  } else {
    const { target } = resolution;
    let idrService: Awaited<ReturnType<typeof resolveIdrService>> | undefined;
    try {
      idrService = await resolveIdrService(
        tenantId,
        target.schemeIdrServiceInstanceId,
        target.registrarIdrServiceInstanceId,
      );
    } catch (error) {
      logger.error({ err: error, credentialId }, 'Publishing requested but no IDR service could be resolved');
      warnings.push({
        code: 'PUBLISH_IDR_UNAVAILABLE',
        message: 'Publishing was requested but no identity resolver service is available for this credential.',
        remediation:
          'Ask your operator to configure an identity resolver service instance for the scheme, the registrar, or the tenant.',
      });
    }

    if (!idrService) return;
    const linkTitle = publishingOptions.linkTitle || dataModel.name;
    let links: ReturnType<typeof buildPublishLinks> | undefined;
    try {
      links = buildPublishLinks(storageResponse, linkTitle, {
        linkType: publishingOptions.linkType ?? idrService.service.defaultLinkType,
        machineVerificationUrl,
        humanVerificationUrl: effectiveHumanVerificationUrl,
        ...(publishingOptions.hreflang !== undefined ? { hreflang: publishingOptions.hreflang } : {}),
        ...(publishingOptions.additionalRels !== undefined ? { additionalRels: publishingOptions.additionalRels } : {}),
        ...(publishingOptions.public !== undefined ? { public: publishingOptions.public } : {}),
        ...(publishingOptions.accessRole !== undefined ? { accessRole: publishingOptions.accessRole } : {}),
      });
    } catch (error) {
      logger.error({ err: error, credentialId }, 'Could not build the publish links');
      warnings.push({
        code: 'PUBLISH_LINKS_UNBUILDABLE',
        message: 'Publishing was requested but the credential links could not be built.',
        remediation:
          'The credential was issued and stored. Ask your operator to check the storage response, then issue again if you need it published.',
      });
    }

    if (!links) return;
    let published = false;
    try {
      await idrService.service.publishLinks(
        target.schemePrimaryKey,
        target.identifierValue,
        links,
        publishingOptions.qualifierPath || '/',
        {
          namespace: target.schemeNamespace,
          description: primaryEntity.entityDescription || primaryEntity.entityName || linkTitle,
        },
      );
      published = true;
    } catch (error) {
      // The upstream error carries the resolver's raw response body, which
      // is operator detail: it goes to the log, not to the caller.
      logger.error(
        { err: error, credentialId, scheme: target.schemePrimaryKey },
        'Failed to publish credential to IDR',
      );
      // A rejection the resolver stated is distinguishable from one where
      // the call itself failed: the second may have committed upstream, so it
      // must not invite a blind retry (the resolver is append-only).
      // A 4xx is the resolver stating it did not accept the links. A 5xx,
      // or a failure of the call itself, may still have committed upstream,
      // so it is reported as unknown rather than as a refusal.
      // The upstream status rides on ServiceError's `context`, which is
      // where IdrPublishError puts it; the error's own statusCode is this
      // service's 502 for any upstream failure. Read it through an
      // instanceof rather than a cast, so a future rename of the field
      // fails the build instead of silently reclassifying every failure.
      const status = error instanceof IdrPublishError ? error.context?.httpStatus : undefined;
      const rejected = typeof status === 'number' && status >= 400 && status < 500;
      warnings.push(
        rejected
          ? {
              code: 'IDR_PUBLISH_FAILED',
              message: 'The identity resolver rejected the credential links, so the credential is not discoverable.',
              remediation:
                'Check that the identifier scheme is registered with the identity resolver, then issue the credential again once it is.',
            }
          : {
              code: 'IDR_PUBLISH_UNCONFIRMED',
              message:
                'The identity resolver could not be reached or did not answer, so whether the credential links were registered is unknown.',
              remediation:
                'Ask your operator to check the resolver for these links before issuing again: a second publish of the same links is rejected as a duplicate.',
            },
      );
    }

    if (published) {
      try {
        await updateCredentialPublished(credentialId, tenantId, true);
      } catch (error) {
        logger.error({ err: error, credentialId }, 'Failed to update published status after publishing');
        warnings.push({
          code: 'DB_STATUS_UPDATE_FAILED',
          message: 'The credential was published to the identity resolver but its published status could not be saved.',
          remediation:
            'The credential is discoverable; only its stored status is stale. No action is needed unless you rely on that flag.',
        });
      }
    }
  }
}

export async function issueCredentialRequest(
  input: IssueCredentialRequestInput,
): Promise<IssueCredentialRequestResult> {
  const { tenantId, body, idempotencyClaimId, onDispatch } = input;
  const { credentialType, version } = body;
  if ('credentialStatus' in body.credentialPayload) {
    throw new ValidationError(`credentialPayload.credentialStatus: ${CREDENTIAL_STATUS_NOT_ACCEPTED_MESSAGE}`, {
      code: 'CREDENTIAL_STATUS_NOT_ACCEPTED',
    });
  }
  if (body.statusPurposes !== undefined && body.statusPurposes.length > 1 && !readStatusMultiplePurposesEnabled()) {
    throw new ValidationError(
      'statusPurposes: only one status purpose can be issued while CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED is false',
      { code: 'VALIDATION_FAILED' },
    );
  }
  const storageOptions = body.storageOptions ?? {};
  const publishingOptions = body.publishingOptions ?? {};

  // ── Verification URL validation ───────────────────────────────────────
  // Caller-supplied verification URLs are always validated as well-formed,
  // absolute, userinfo-free http(s) URLs before issuance, so a malformed,
  // non-http(s), or credential-bearing value is rejected up front rather than
  // published or failing later during link construction. assertHttpUrl returns
  // the WHATWG-canonical URL, and the canonical `href` (not the raw caller
  // string) is what is SSRF-checked and published downstream. Validating and
  // publishing the same canonical form closes a parser-differential SSRF gap:
  // a value like `https://1.1.1.1\@127.0.0.1/` that this parser reads as host
  // `1.1.1.1` cannot be re-read as `127.0.0.1` by a different parser once the
  // canonical `href` (`https://1.1.1.1/@127.0.0.1/`) is what leaves the route.
  // The private-address / DNS SSRF check is additionally applied unless
  // FETCH_ALLOW_PRIVATE_URLS relaxes it for local development.
  const machineVerificationUrl = publishingOptions.machineVerificationUrl
    ? assertHttpUrl(publishingOptions.machineVerificationUrl, 'publishingOptions.machineVerificationUrl').href
    : undefined;
  const humanVerificationUrl = publishingOptions.humanVerificationUrl
    ? assertHttpUrl(publishingOptions.humanVerificationUrl, 'publishingOptions.humanVerificationUrl').href
    : undefined;
  if (!readFetchAllowPrivateUrls()) {
    if (machineVerificationUrl)
      await assertPublicUrl(machineVerificationUrl, 'publishingOptions.machineVerificationUrl');
    if (humanVerificationUrl) await assertPublicUrl(humanVerificationUrl, 'publishingOptions.humanVerificationUrl');
  }
  const effectiveHumanVerificationUrl =
    publishingOptions.publish === true && !humanVerificationUrl ? defaultHumanVerificationUrl() : humanVerificationUrl;

  const { dataModel, bridge, schemaUrls, coreDataModelVersion, coreDataModelType } = await resolveDataModel(
    tenantId,
    credentialType,
    version,
  );
  await validateCredentialPayload(body.credentialPayload, schemaUrls, schemaLoader);
  const credentialPayload = body.credentialPayload as CredentialPayload;

  const warnings: CredentialWarning[] = [];
  let refs: ExtractedRefs | undefined;
  try {
    refs = bridge.extractRefs(credentialPayload.credentialSubject as Record<string, unknown>);
  } catch (error) {
    logger.error({ err: error, credentialType }, 'Reference extraction failed');
    if (publishingOptions.publish) {
      warnings.push({
        code: 'REFS_EXTRACTION_FAILED',
        message: 'Publishing was requested but no identifier could be extracted from the credential payload.',
        remediation:
          "Check that the credential's subject carries the identifier fields its data model defines, such as a registeredId on the party or product.",
      });
    }
  }

  // ── Step 3.6: Conformity claim validation (advisory) ────────────────────
  // For credentials carrying a conformity claim (the DCC), cross-check the
  // claim's scheme / profile / criteria URIs, its conformity topics and its
  // score codes against the locally cached vocabulary, and diagnose a
  // reference that names the wrong catalogue tier. Advisory only per ADR-033
  // §3 and ADR-059: a mismatch never blocks issuance; it surfaces as
  // `conformity-*` warnings on the response. Reads only the local projection
  // (no network).
  try {
    const extracted = bridge.extractConformityClaimWithProvenance(
      credentialPayload.credentialSubject as Record<string, unknown>,
    );
    if (extracted) {
      warnings.push(...(await validateConformityClaimAtIssuance(extracted, credentialPayload, tenantId)));
    }
  } catch (error) {
    logger.error({ err: error, credentialType }, 'Conformity claim validation failed');
    warnings.push({
      code: 'conformity-claim.validation-error',
      message:
        'Conformity claim validation could not be performed; credential was issued without conformity vocabulary checks.',
    });
  }

  const issuer = credentialPayload.issuer;
  const issuerDid = typeof issuer === 'string' ? issuer : issuer?.id;
  if (!issuerDid) {
    throw new ValidationError('credentialPayload.issuer.id is required', { code: 'ISSUER_DID_REQUIRED' });
  }
  const didRecord = await getDidByDid(issuerDid, tenantId);
  if (!didRecord) {
    throw new ValidationError(
      `Issuer DID "${issuerDid}" is not registered to your tenant. You can only issue credentials with a DID that belongs to your tenant or the system default DID.`,
      { code: 'ISSUER_DID_NOT_REGISTERED' },
    );
  }
  if (!didRecord.serviceInstanceId) {
    throw new ValidationError(
      `Issuer DID "${issuerDid}" has no associated VC service instance. The DID may have lost its service association (e.g., the service instance was force-deleted). Re-import or re-create the DID to restore the association.`,
      { code: 'ISSUER_DID_SERVICE_INSTANCE_MISSING' },
    );
  }

  const vcService = await resolveVcService(tenantId, didRecord.serviceInstanceId);
  const storageService = await resolveStorageService(tenantId, storageOptions.serviceInstanceId);
  onDispatch?.();
  const issued = await issueCredential({
    tenantId,
    credentialPayload,
    credentialType,
    refs: refs ?? { organisations: [], facilities: [], products: [] },
    vcService,
    storageService,
    storageOptions,
    bridge,
    coreDataModelVersion,
    coreCredentialType: resolveCoreCredentialType(coreDataModelType),
    ...(body.statusPurposes !== undefined ? { statusPurposes: body.statusPurposes } : {}),
    ...(idempotencyClaimId !== undefined ? { idempotencyClaimId } : {}),
  });

  const {
    credentialId,
    storageResponse,
    primaryEntity,
    entityLinkFailed,
    detailsExtractionFailed,
    statusCaptureFailed,
    statusCaptureFailure,
  } = issued;
  if (detailsExtractionFailed) {
    warnings.push({
      code: 'DETAILS_EXTRACTION_FAILED',
      message:
        'The credential was issued but its name, issuer, subject and validity dates could not be read from it, so they are not recorded against it.',
      remediation: `The credential itself is unaffected and can be retrieved and verified as usual. Only its stored summary is missing. Quote correlation ID ${getOrMintCorrelationId()} to your operator, who can find the cause in the logs.`,
    });
  }
  if (statusCaptureFailed) {
    const retryableStatusCaptureFailure =
      statusCaptureFailure === 'DECRYPT_FAILED' || statusCaptureFailure === 'STORAGE_UNAVAILABLE';
    warnings.push({
      code: 'STATUS_CAPTURE_FAILED',
      message: 'The credential was issued but its credential-status entries could not be recorded.',
      remediation:
        statusCaptureFailure === undefined
          ? 'Ask your operator to run the credential-status backfill and inspect its failure report.'
          : retryableStatusCaptureFailure
            ? `Ask your operator to run backfill-credential-status-entries --retry-failed for ${statusCaptureFailure}.`
            : `Ask your operator to investigate the provider output for ${statusCaptureFailure}; the entry was not recorded.`,
    });
  }
  if (entityLinkFailed) {
    warnings.push({
      code: 'ENTITY_LINK_FAILED',
      message: 'The credential was issued but could not be linked to its master-data record, which no longer exists.',
      remediation:
        'Re-create the master-data record if the link matters to you. The credential itself is unaffected, and publishing does not depend on the link.',
    });
  }

  await publishIssuedCredential({
    publishingOptions,
    refs,
    tenantId,
    credentialId,
    warnings,
    storageResponse,
    dataModel,
    primaryEntity,
    machineVerificationUrl,
    effectiveHumanVerificationUrl,
  });

  return {
    status: 201,
    body: {
      credentialId,
      ...(statusCaptureFailed ? { statusCaptureFailed: true } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}
