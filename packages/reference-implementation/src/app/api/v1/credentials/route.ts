import { NextResponse } from 'next/server';
import {
  ValidationError,
  isNonEmptyString,
  parsePositiveInt,
  parseNonNegativeInt,
  parseBooleanString,
  assertPublicUrl,
  assertHttpUrl,
} from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { errorMessage } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { resolveDataModel } from '@/lib/credentials/resolve-data-model';
import { validateCredentialPayload } from '@/lib/credentials/validate-credential-payload';
import { issueCredential } from '@/lib/credentials/issue-credential';
import { revealDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { schemaLoader } from '@/lib/credentials/schema-loader';
import { updateCredentialPublished, listCredentials } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { getDidByDid, findConformitySchemeByCanonicalId } from '@/lib/prisma/repositories';
import { buildPublishLinks } from '@uncefact/untp-ri-services';
import type { CredentialPayload, ExtractedRefs } from '@uncefact/untp-ri-services';
import { validateConformityClaim } from '@uncefact/untp-utils/conformity-vocabulary';
import { publishingOptionsSchema } from '@/lib/swagger/schemas';

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
 * Builds the default human verification link base URL from `RI_APP_URL`.
 *
 * Used when a caller requests publishing without an explicit
 * `publishingOptions.humanVerificationUrl`, so every published credential
 * carries a link to this Reference Implementation's own verify page. `RI_APP_URL`
 * is the RI's public base URL (the same variable that backs the OIDC
 * post-logout redirect); the verify page lives at `/verify`.
 *
 * Throws a {@link ValidationError} when `RI_APP_URL` is missing, is not a valid
 * http(s) URL, or carries userinfo (a `user:pass@` component, which would be
 * published into a public link). A deployment that asked to publish but cannot
 * build a safe link fails with an actionable message instead of publishing a
 * broken or secret-bearing link. The caller can also remedy it per-request by
 * supplying `publishingOptions.humanVerificationUrl`.
 */
function defaultHumanVerificationUrl(): string {
  const base = process.env.RI_APP_URL;
  if (!base) {
    throw new ValidationError(
      'Publishing requires a human verification URL. Set the RI_APP_URL environment variable, or pass publishingOptions.humanVerificationUrl.',
    );
  }

  let url: URL | undefined;
  try {
    url = new URL(base);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new ValidationError(
      'RI_APP_URL is not a valid http(s) URL. Set a valid RI_APP_URL, or pass publishingOptions.humanVerificationUrl.',
    );
  }
  if (url.username || url.password) {
    throw new ValidationError(
      'RI_APP_URL must not contain a username or password; the verify link is published to a public directory. Remove the userinfo from RI_APP_URL, or pass publishingOptions.humanVerificationUrl.',
    );
  }

  // Build from URL components so a query or fragment on RI_APP_URL cannot land
  // ahead of the appended path segment (e.g. `https://ri/?x=1` must not become
  // `https://ri/?x=1/verify`). Any base path is preserved.
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/verify`;
  return url.toString();
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
 *         description: Credential issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CredentialIssueResponse'
 *       400:
 *         description: Validation error (invalid payload, unknown data model, or issuer DID not registered to tenant)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Data model or service instance not found
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
  let body: {
    credentialPayload?: CredentialPayload;
    credentialType?: string;
    version?: string;
    storageOptions?: {
      serviceInstanceId?: string;
      encrypt?: boolean;
    };
    publishingOptions?: {
      publish?: boolean;
      linkType?: string;
      linkTitle?: string;
      qualifierPath?: string;
      machineVerificationUrl?: string;
      humanVerificationUrl?: string;
      hreflang?: string[];
      additionalRels?: string[];
      public?: boolean;
    };
  };

  logger.info('Parsing request body');
  try {
    body = await req.json();
  } catch (e) {
    logger.warn({ err: e }, 'Failed to parse request body as JSON');
    throw new ValidationError('Invalid JSON body');
  }

  // ── Step 1: Validate request ────────────────────────────────────────────

  logger.info('Validating input parameters');
  if (!body.credentialPayload || typeof body.credentialPayload !== 'object') {
    throw new ValidationError('credentialPayload is required and must be an object');
  }

  if (!isNonEmptyString(body.credentialType)) {
    throw new ValidationError('credentialType is required');
  }

  if (!isNonEmptyString(body.version)) {
    throw new ValidationError('version is required');
  }

  const { credentialPayload, credentialType, version } = body;
  const storageOptions = body.storageOptions ?? {};

  const publishingOptionsParse = publishingOptionsSchema.safeParse(body.publishingOptions ?? {});
  if (!publishingOptionsParse.success) {
    const issue = publishingOptionsParse.error.issues[0];
    throw new ValidationError(`publishingOptions.${issue.path.join('.') || ''}: ${issue.message}`);
  }
  const publishingOptions = publishingOptionsParse.data;

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
  // Resolved here, before issuance (Step 7), so a deployment that requested
  // publishing but cannot build the link fails before any credential is signed
  // or stored. The derived default is trusted operator config, so it is
  // intentionally not SSRF-checked and a localhost RI_APP_URL is accepted in
  // development.
  const effectiveHumanVerificationUrl =
    publishingOptions.publish === true && !humanVerificationUrl ? defaultHumanVerificationUrl() : humanVerificationUrl;

  // ── Step 2: Resolve data model ──────────────────────────────────────────

  logger.info({ credentialType, version }, 'Resolving data model');
  const { dataModel, bridge, schemaUrls } = await resolveDataModel(tenantId, credentialType, version);

  // ── Step 3: Validate payload ────────────────────────────────────────────

  logger.info('Validating credential payload against schema');
  await validateCredentialPayload(credentialPayload, schemaUrls, schemaLoader);

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
        message: 'Failed to extract references from credential payload — publishing will be skipped',
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
    const claim = bridge.extractConformityClaim(subject);
    if (claim) {
      const scheme = await findConformitySchemeByCanonicalId(claim.scheme, tenantId);
      warnings.push(...validateConformityClaim(claim, scheme));
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
    logger.warn({ issuerDid, tenantId }, 'Issuer DID not found for tenant');
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
  const { credentialId, storageResponse, primaryEntity } = await issueCredential({
    tenantId,
    credentialPayload,
    credentialType,
    refs: refs ?? { organisations: [], facilities: [], products: [] },
    vcService,
    storageService,
    storageOptions,
  });

  // ── Step 8: Publish to IDR ──────────────────────────────────────────────

  if (publishingOptions.publish === true && refs) {
    if (!primaryEntity.schemePrimaryKey || !primaryEntity.schemeNamespace) {
      logger.warn({ credentialId }, 'Publishing requested but entity has no scheme configuration — skipping');
      warnings.push({
        code: 'PUBLISH_SKIPPED' as const,
        message: 'Publishing was requested but the entity has no identity scheme configuration',
      });
    } else if (!primaryEntity.primaryIdentifier) {
      logger.warn({ credentialId }, 'Publishing requested but no primary identifier resolved — skipping');
      warnings.push({
        code: 'PUBLISH_SKIPPED' as const,
        message: 'Publishing was requested but no primary identifier could be resolved from the credential payload',
      });
    } else {
      // Resolve IDR service outside try-catch — config failures should be fatal
      const idrService = await resolveIdrService(tenantId, primaryEntity.schemeIdrServiceInstanceId);

      const linkTitle = publishingOptions.linkTitle || dataModel.name;
      const links = buildPublishLinks(storageResponse, linkTitle, {
        linkType: publishingOptions.linkType,
        machineVerificationUrl,
        humanVerificationUrl: effectiveHumanVerificationUrl,
        ...(publishingOptions.hreflang !== undefined ? { hreflang: publishingOptions.hreflang } : {}),
        ...(publishingOptions.additionalRels !== undefined ? { additionalRels: publishingOptions.additionalRels } : {}),
        ...(publishingOptions.public !== undefined ? { public: publishingOptions.public } : {}),
      });

      logger.info(
        { idrInstanceId: idrService.instanceId, primaryIdentifier: primaryEntity.primaryIdentifier },
        'Publishing credential to IDR',
      );

      try {
        await idrService.service.publishLinks(
          primaryEntity.schemePrimaryKey,
          primaryEntity.primaryIdentifier,
          links,
          publishingOptions.qualifierPath || '/',
          {
            namespace: primaryEntity.schemeNamespace,
            description: primaryEntity.entityDescription || primaryEntity.entityName,
          },
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error(
          { err: error, credentialId, scheme: primaryEntity.schemePrimaryKey },
          'Failed to publish credential to IDR',
        );
        warnings.push({
          code: 'IDR_PUBLISH_FAILED',
          message: `Failed to publish credential to identity resolver: ${detail}. Ensure the identifier scheme is registered with the IDR service. Contact your IDR operator if this persists.`,
        });
      }

      if (!warnings.some((w) => w.code === 'IDR_PUBLISH_FAILED')) {
        try {
          await updateCredentialPublished(credentialId, tenantId, true);
        } catch (error) {
          logger.error(
            { err: error, credentialId },
            'Failed to update published status — credential was published to IDR but DB record is stale',
          );
          warnings.push({
            code: 'DB_STATUS_UPDATE_FAILED' as const,
            message: 'Credential was published to IDR but the published status could not be saved',
          });
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
 *           default: 20
 *         description: Maximum number of results
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of results to skip
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
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised
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
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);

  logger.info('Parsing query filters');
  const credentialType = url.searchParams.get('credentialType') ?? undefined;
  const isPublished = parseBooleanString(url.searchParams.get('isPublished'), 'isPublished');
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

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
      logger.error({ err: error, credentialId: credential.id }, 'Failed to reveal a stored decryption key');
      throw new Error(`${errorMessage(error)} (credential ${credential.id})`, { cause: error });
    }
  });
  return NextResponse.json(buildPaginatedResponse(credentials, total, limit, offset));
});
