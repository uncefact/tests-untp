import { NextResponse } from 'next/server';
import {
  ValidationError,
  parseRequestBody,
  parseQueryParams,
  assertPublicUrl,
  assertHttpUrl,
} from '@/lib/api/validation';
import { credentialIssueRequestSchema, listCredentialsQuerySchema } from '@/lib/api/request-schemas/credential';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { resolveAppUrl, buildVerifyUrl } from '@/lib/config/app-url.config';
import { apiLogger } from '@/lib/api/logger';
import { resolveDataModel } from '@/lib/credentials/resolve-data-model';
import { validateCredentialPayload } from '@/lib/credentials/validate-credential-payload';
import { issueCredential } from '@/lib/credentials/issue-credential';
import { revealDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { schemaLoader } from '@/lib/credentials/schema-loader';
import { updateCredentialPublished, listCredentials } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { resolvePublishTarget } from '@/lib/credentials/resolve-publish-target';
import { getDidByDid, findConformitySchemeByCanonicalId } from '@/lib/prisma/repositories';
import { buildPublishLinks, remapWarningPointers, IdrPublishError } from '@uncefact/untp-ri-services';
import type { CredentialPayload, ExtractedRefs } from '@uncefact/untp-ri-services';
import { validateConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';

type CredentialWarning = {
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
  remediation?: string;
  pointer?: string;
};

const logger = apiLogger.child({ route: '/api/v1/credentials' });

/**
 * Default human verification link: this RI's own verify page, built from the
 * boot-validated RI_APP_URL (see instrumentation.node.ts). Used when a caller
 * requests publishing without an explicit publishingOptions.humanVerificationUrl.
 */
function defaultHumanVerificationUrl(): string {
  return buildVerifyUrl(resolveAppUrl());
}

// ---------------------------------------------------------------------------
// POST /api/v1/credentials
// ---------------------------------------------------------------------------

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
 *     tags:
 *       - Credentials
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
 *           ignored). An unknown data model (credentialType and version pair)
 *           and an issuer DID not registered to the tenant are also 400s.
 *           Payload-validation failures carry
 *           a `code`: `SCHEMA_DOCUMENT_INVALID` or `JSONLD_DOCUMENT_INVALID`
 *           mean the payload itself is invalid and the message says what to
 *           fix; `SCHEMA_FETCH_FAILED` or `JSONLD_CONTEXT_FETCH_FAILED` mean
 *           a remote schema or `@context` could not be fetched or used,
 *           which reflects an upstream or configuration condition rather
 *           than a payload fault (the schema message names the schema URL;
 *           the context message carries the HTTP status or timeout where
 *           one applies).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId }) => {
  // ── Step 1: Validate request ────────────────────────────────────────────

  logger.info('Parsing and validating request body');
  const body = await parseRequestBody(req, credentialIssueRequestSchema);

  const { credentialType, version } = body;
  // Omitted option objects stay empty objects, as they always have: an
  // undefined publishingOptions must not change the happy-path publish and
  // encrypt defaults downstream.
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
  // VERIFY_ALLOW_PRIVATE_URLS relaxes it for local development.
  const machineVerificationUrl = publishingOptions.machineVerificationUrl
    ? assertHttpUrl(publishingOptions.machineVerificationUrl, 'publishingOptions.machineVerificationUrl').href
    : undefined;
  const humanVerificationUrl = publishingOptions.humanVerificationUrl
    ? assertHttpUrl(publishingOptions.humanVerificationUrl, 'publishingOptions.humanVerificationUrl').href
    : undefined;
  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    if (machineVerificationUrl) {
      await assertPublicUrl(machineVerificationUrl, 'publishingOptions.machineVerificationUrl');
    }
    if (humanVerificationUrl) {
      await assertPublicUrl(humanVerificationUrl, 'publishingOptions.humanVerificationUrl');
    }
  }

  // ── Default the human verification link (see defaultHumanVerificationUrl) ─
  // RI_APP_URL is boot-validated (instrumentation.node.ts), so this is plain
  // construction. The derived default is trusted operator config, so it is
  // intentionally not SSRF-checked and a localhost RI_APP_URL is accepted in
  // development.
  const effectiveHumanVerificationUrl =
    publishingOptions.publish === true && !humanVerificationUrl ? defaultHumanVerificationUrl() : humanVerificationUrl;

  // ── Step 2: Resolve data model ──────────────────────────────────────────

  logger.info({ credentialType, version }, 'Resolving data model');
  const { dataModel, bridge, schemaUrls } = await resolveDataModel(tenantId, credentialType, version);

  // ── Step 3: Validate payload ────────────────────────────────────────────

  logger.info('Validating credential payload against schema');
  await validateCredentialPayload(body.credentialPayload, schemaUrls, schemaLoader);

  // The boundary schema keeps the payload an open object; the JSON Schema +
  // JSON-LD pass above is what actually inspects it, so this is the one place
  // the opaque record is asserted to the payload type the rest of the handler
  // (and issueCredential) works with.
  const credentialPayload = body.credentialPayload as CredentialPayload;

  // ── Step 3.5: Extract entity references for publishing ──────────────────

  const warnings: CredentialWarning[] = [];

  let refs: ExtractedRefs | undefined;
  try {
    const subject = credentialPayload.credentialSubject as Record<string, unknown>;
    refs = bridge.extractRefs(subject);
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
  // claim's scheme / profile / criteria URIs against the locally cached
  // vocabulary. Advisory only per ADR-033 §3: a mismatch never blocks
  // issuance; it surfaces as `conformity-*` warnings on the response. Reads
  // only the local projection (no network).
  try {
    const subject = credentialPayload.credentialSubject as Record<string, unknown>;
    // The validator's pointers address the extracted claim, which is a
    // synthesised projection the caller never sees, so they are rewritten onto
    // the submitted credential using the paths the extractor recorded (#753).
    // A pointer that cannot be translated is dropped rather than returned.
    const extracted = bridge.extractConformityClaimWithProvenance(subject);
    if (extracted) {
      const scheme = await findConformitySchemeByCanonicalId(extracted.claim.scheme, tenantId);
      const claimWarnings = validateConformityClaim(extracted.claim, scheme);
      warnings.push(
        ...remapWarningPointers(claimWarnings, extracted.sourceMap, credentialPayload, '/credentialSubject'),
      );
    }
  } catch (error) {
    logger.error({ err: error, credentialType }, 'Conformity claim validation failed');
    warnings.push({
      code: 'conformity-claim.validation-error',
      message:
        'Conformity claim validation could not be performed; credential was issued without conformity vocabulary checks.',
    });
  }

  // ── Step 4: Validate issuer DID ownership ────────────────────────────────
  // The issuer DID in the credential payload must belong to the authenticated
  // tenant or be the system default DID. This prevents a tenant from signing
  // credentials with a DID they do not control.

  const issuer = credentialPayload.issuer;
  const issuerDid = typeof issuer === 'string' ? issuer : issuer?.id;
  if (!issuerDid) {
    throw new ValidationError('credentialPayload.issuer.id is required');
  }

  logger.info({ issuerDid }, 'Validating issuer DID ownership');
  const didRecord = await getDidByDid(issuerDid, tenantId);
  if (!didRecord) {
    logger.warn({ issuerDid }, 'Issuer DID not found for tenant');
    throw new ValidationError(
      `Issuer DID "${issuerDid}" is not registered to your tenant. ` +
        'You can only issue credentials with a DID that belongs to your tenant or the system default DID.',
    );
  }

  // ── Step 5: Validate DID has a VC service association ──────────────────

  if (!didRecord.serviceInstanceId) {
    logger.warn({ issuerDid }, 'Issuer DID has no associated VC service instance');
    throw new ValidationError(
      `Issuer DID "${issuerDid}" has no associated VC service instance. ` +
        'The DID may have lost its service association (e.g., the service instance was force-deleted). ' +
        'Re-import or re-create the DID to restore the association.',
    );
  }

  // ── Step 6: Resolve services ────────────────────────────────────────────
  // The VC service is resolved from the DID's associated service instance,
  // ensuring signing always happens on the VC service that holds the DID's
  // key material. This works for both tenant-owned and system default DIDs.

  logger.info({ vcServiceInstanceId: didRecord.serviceInstanceId }, 'Resolving VC and storage services');
  const vcService = await resolveVcService(tenantId, didRecord.serviceInstanceId);
  const storageService = await resolveStorageService(tenantId, storageOptions.serviceInstanceId);

  // ── Step 7: Issue credential ────────────────────────────────────────────

  logger.info({ credentialType }, 'Issuing credential');
  const { credentialId, storageResponse, primaryEntity, entityLinkFailed } = await issueCredential({
    tenantId,
    credentialPayload,
    credentialType,
    refs: refs ?? { organisations: [], facilities: [], products: [] },
    vcService,
    storageService,
    storageOptions,
  });

  if (entityLinkFailed) {
    warnings.push({
      code: 'ENTITY_LINK_FAILED' as const,
      message: 'The credential was issued but could not be linked to its master-data record, which no longer exists.',
      remediation:
        'Re-create the master-data record if the link matters to you. The credential itself is unaffected, and publishing does not depend on the link.',
    });
  }

  // ── Step 8: Publish to IDR ──────────────────────────────────────────────

  if (publishingOptions.publish === true && refs) {
    // Publishing resolves its target from the credential's own identifier
    // (ADR-043): the scheme, registrar and IDR instance all hang off
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
        code: 'PUBLISH_IDENTIFIER_AMBIGUOUS' as const,
        message: `Publishing was requested but the identifier "${resolution.value}" exists under more than one scheme.`,
        remediation: `Set publishingOptions.identifierSchemeId to the scheme you want to publish under. Candidates: ${resolution.candidates
          .map((candidate) => `${candidate.schemeName} (${candidate.schemeId})`)
          .join(', ')}.`,
      });
    } else if (resolution.outcome === 'not-found') {
      warnings.push({
        code: 'PUBLISH_IDENTIFIER_UNKNOWN' as const,
        message: `Publishing was requested but no identifier matching "${resolution.value}" is registered for this tenant.`,
        remediation: 'Register the identifier under an identifier scheme, then issue the credential again.',
      });
    } else if (resolution.outcome === 'no-reference') {
      warnings.push({
        code: 'PUBLISH_REFERENCE_MISSING' as const,
        message: 'Publishing was requested but the credential payload carries no identifier to publish under.',
        remediation:
          "Check that the credential's subject carries the identifier fields its data model defines, such as a registeredId on the party or product.",
      });
    } else if (resolution.outcome === 'unavailable') {
      warnings.push({
        code: 'PUBLISH_TARGET_UNRESOLVED' as const,
        message: "Publishing was requested but the credential's identifier could not be looked up.",
        remediation:
          'The credential was issued. Ask your operator to check the service, then issue again if you need it published.',
      });
    } else if (resolution.outcome === 'incomplete') {
      warnings.push({
        code: 'PUBLISH_SCHEME_INCOMPLETE' as const,
        message: `Publishing was requested but the identifier "${resolution.value}" belongs to a scheme without both a primary key and a registrar namespace.`,
        remediation:
          'Give the identifier scheme a primary key, and its registrar a namespace, then issue the credential again.',
      });
    } else {
      const { target } = resolution;
      let idrService: Awaited<ReturnType<typeof resolveIdrService>> | undefined;
      try {
        // Scheme, then registrar, then tenant or system default, matching how
        // POST /identifiers/{id}/links resolves the same chain.
        idrService = await resolveIdrService(
          tenantId,
          target.schemeIdrServiceInstanceId,
          target.registrarIdrServiceInstanceId,
        );
      } catch (error) {
        logger.error({ err: error, credentialId }, 'Publishing requested but no IDR service could be resolved');
        warnings.push({
          code: 'PUBLISH_IDR_UNAVAILABLE' as const,
          message: 'Publishing was requested but no identity resolver service is available for this credential.',
          remediation:
            'Ask your operator to configure an identity resolver service instance for the scheme, the registrar, or the tenant.',
        });
      }

      if (idrService) {
        const linkTitle = publishingOptions.linkTitle || dataModel.name;
        let links: ReturnType<typeof buildPublishLinks> | undefined;
        try {
          links = buildPublishLinks(storageResponse, linkTitle, {
            linkType: publishingOptions.linkType ?? idrService.service.defaultLinkType,
            machineVerificationUrl,
            humanVerificationUrl: effectiveHumanVerificationUrl,
            ...(publishingOptions.hreflang !== undefined ? { hreflang: publishingOptions.hreflang } : {}),
            ...(publishingOptions.additionalRels !== undefined
              ? { additionalRels: publishingOptions.additionalRels }
              : {}),
            ...(publishingOptions.public !== undefined ? { public: publishingOptions.public } : {}),
            ...(publishingOptions.accessRole !== undefined ? { accessRole: publishingOptions.accessRole } : {}),
          });
        } catch (error) {
          logger.error({ err: error, credentialId }, 'Could not build the publish links');
          warnings.push({
            code: 'PUBLISH_LINKS_UNBUILDABLE' as const,
            message: 'Publishing was requested but the credential links could not be built.',
            remediation:
              'The credential was issued and stored. Ask your operator to check the storage response, then issue again if you need it published.',
          });
        }

        let published = false;
        if (links) {
          logger.info(
            { idrInstanceId: idrService.instanceId, primaryIdentifier: target.identifierValue },
            'Publishing credential to IDR',
          );
          try {
            await idrService.service.publishLinks(
              target.schemePrimaryKey,
              target.identifierValue,
              links,
              publishingOptions.qualifierPath || '/',
              {
                namespace: target.schemeNamespace,
                // The resolver requires a non-empty description. The entity
                // supplied it before publishing was decoupled from entity
                // matching; with no entity the link title is the stable
                // fallback, itself defaulting to the data model's name.
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
            // the call itself failed: the second may have committed upstream, so
            // it must not invite a blind retry (the resolver is append-only).
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
                    code: 'IDR_PUBLISH_FAILED' as const,
                    message:
                      'The identity resolver rejected the credential links, so the credential is not discoverable.',
                    remediation:
                      'Check that the identifier scheme is registered with the identity resolver, then issue the credential again once it is.',
                  }
                : {
                    code: 'IDR_PUBLISH_UNCONFIRMED' as const,
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
              logger.error(
                { err: error, credentialId },
                'Failed to update published status — credential was published to IDR but DB record is stale',
              );
              warnings.push({
                code: 'DB_STATUS_UPDATE_FAILED' as const,
                message:
                  'The credential was published to the identity resolver but its published status could not be saved.',
                remediation:
                  'The credential is discoverable; only its stored status is stale. No action is needed unless you rely on that flag.',
              });
            }
          }
        }
      }
    }
  }

  logger.info({ credentialId }, 'Credential issued successfully');
  const response: Record<string, unknown> = { credentialId };
  if (warnings.length > 0) response.warnings = warnings;
  return NextResponse.json(response, { status: 201 });
});

// ---------------------------------------------------------------------------
// GET /api/v1/credentials
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /credentials:
 *   get:
 *     summary: List credentials
 *     description: |
 *       Returns a paginated, filterable list of credentials scoped to
 *       the authenticated tenant.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: query
 *         name: credentialType
 *         schema:
 *           type: string
 *         description: Filter by credential type (case-sensitive exact match)
 *       - in: query
 *         name: isPublished
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Filter by published status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of credentials to return per page. Defaults to 20 unless the deployment maximum is lower. Values above the deployment maximum are rejected with a 400 naming the maximum.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of credentials to skip for pagination
 *     responses:
 *       200:
 *         description: Paginated list of credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - data
 *                 - pagination
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Credential'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error (malformed or repeated query parameter, non-integer or out-of-range pagination value, or non-boolean isPublished)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);

  logger.info('Parsing query filters');
  const { credentialType, isPublished, limit, offset } = parseQueryParams(url, listCredentialsQuerySchema);

  logger.info({ filters: { credentialType, isPublished, limit, offset } }, 'Querying credentials from database');
  const { data, total } = await listCredentials({
    tenantId,
    credentialType,
    isPublished,
    limit,
    offset,
  });

  logger.info({ count: data.length }, 'Credentials listed');
  const credentials = data.map((credential) => {
    try {
      return { ...credential, decryptionKey: revealDecryptionKey(credential.decryptionKey) };
    } catch (error) {
      // The underlying message names the operator's encryption key, so it
      // stays in the log; the caller gets the sanitised 500 every other
      // unhandled failure returns (ADR-036).
      logger.error({ err: error, credentialId: credential.id }, 'Failed to reveal a stored decryption key');
      throw new Error('Failed to read a stored credential', { cause: error });
    }
  });
  return NextResponse.json(buildPaginatedResponse(credentials, total, limit, offset));
});
