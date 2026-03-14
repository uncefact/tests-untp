import { NextResponse } from 'next/server';
import {
  ValidationError,
  isNonEmptyString,
  parsePositiveInt,
  parseNonNegativeInt,
  parseBooleanString,
} from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { resolveDataModel, isDccDataModel } from '@/lib/credentials/resolve-data-model';
import { validateCredentialPayload } from '@/lib/credentials/validate-credential-payload';
import { issueCredential } from '@/lib/credentials/issue-credential';
import { updateCredentialPublished, listCredentials } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { buildPublishLinks } from '@uncefact/untp-ri-services';
import type { CredentialPayload, ExtractedRefs } from '@uncefact/untp-ri-services';
import { validateCvcCompliance } from '@/lib/services/cvc-validation.service';
import type { CvcValidationWarning } from '@/lib/services/cvc-validation.service';

const logger = apiLogger.child({ route: '/api/v1/credentials' });

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
 *       signs it, stores the enveloped credential (optionally encrypted),
 *       optionally publishes it to the Identity Resolver, links it to its
 *       primary entity, and returns the credential ID.
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: {
    credentialPayload?: CredentialPayload;
    credentialType?: string;
    version?: string;
    signingOptions?: {
      serviceInstanceId?: string;
    };
    storageOptions?: {
      serviceInstanceId?: string;
      encrypt?: boolean;
    };
    publishingOptions?: {
      publish?: boolean;
      serviceInstanceId?: string;
      linkType?: string;
      linkTitle?: string;
      machineVerificationUrl?: string;
      humanVerificationUrl?: string;
    };
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  // ── Step 1: Validate request ────────────────────────────────────────────

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
  const signingOptions = body.signingOptions ?? {};
  const storageOptions = body.storageOptions ?? {};
  const publishingOptions = body.publishingOptions ?? {};

  // ── Step 2: Resolve data model ──────────────────────────────────────────

  const { dataModel, bridge, schemaUrls } = await resolveDataModel(tenantId, credentialType, version);

  // ── Step 3: Validate payload ────────────────────────────────────────────

  await validateCredentialPayload(credentialPayload, schemaUrls);

  // ── Step 3.5: CVC validation (advisory) ─────────────────────────────

  let cvcWarnings: CvcValidationWarning[] = [];
  const isDcc = isDccDataModel(dataModel);

  let refs: ExtractedRefs | undefined;
  try {
    const subject = credentialPayload.credentialSubject as Record<string, unknown>;
    refs = bridge.extractRefs(subject);
  } catch (error) {
    logger.error({ err: error, tenantId, credentialType }, 'Reference extraction failed');
    cvcWarnings = [
      {
        code: 'CVC_VALIDATION_ERROR' as const,
        message: 'Failed to extract references from credential payload',
      },
    ];
  }

  if (isDcc && refs?.conformity) {
    try {
      const result = await validateCvcCompliance(tenantId, refs.conformity);
      cvcWarnings = result.warnings;
    } catch (error) {
      logger.error({ err: error, tenantId, credentialType }, 'CVC compliance validation failed');
      cvcWarnings = [
        {
          code: 'CVC_VALIDATION_ERROR' as const,
          message: 'CVC validation could not be performed — credential was issued without CVC checks',
        },
      ];
    }
  }

  // ── Step 4: Resolve services ────────────────────────────────────────────

  const vcService = await resolveVcService(tenantId, signingOptions.serviceInstanceId);
  const storageService = await resolveStorageService(tenantId, storageOptions.serviceInstanceId);

  // ── Step 5: Issue credential ────────────────────────────────────────────

  const { credentialId, storageResponse, primaryEntity } = await issueCredential({
    tenantId,
    credentialPayload,
    credentialType,
    bridge,
    vcService,
    storageService,
    storageOptions,
  });

  // ── Step 6: Publish to IDR ──────────────────────────────────────────────

  if (publishingOptions.publish === true) {
    if (!primaryEntity.schemePrimaryKey || !primaryEntity.schemeNamespace) {
      logger.warn({ tenantId, credentialId }, 'Publishing requested but entity has no scheme configuration — skipping');
    } else if (!primaryEntity.primaryIdentifier) {
      logger.warn({ tenantId, credentialId }, 'Publishing requested but no primary identifier resolved — skipping');
    } else {
      const idrService = await resolveIdrService(
        tenantId,
        primaryEntity.schemeIdrServiceInstanceId,
        publishingOptions.serviceInstanceId,
      );

      const linkTitle = publishingOptions.linkTitle || dataModel.name;
      const links = buildPublishLinks(storageResponse, linkTitle, {
        linkType: publishingOptions.linkType,
        machineVerificationUrl: publishingOptions.machineVerificationUrl,
        humanVerificationUrl: publishingOptions.humanVerificationUrl,
      });

      logger.info(
        { tenantId, idrInstanceId: idrService.instanceId, primaryIdentifier: primaryEntity.primaryIdentifier },
        'Publishing credential to IDR',
      );

      await idrService.service.publishLinks(
        primaryEntity.schemePrimaryKey,
        primaryEntity.primaryIdentifier,
        links,
        '/',
        {
          namespace: primaryEntity.schemeNamespace,
          itemDescription: linkTitle,
        },
      );

      await updateCredentialPublished(credentialId, tenantId, true);
    }
  }

  const response: Record<string, unknown> = { credentialId };
  if (cvcWarnings.length > 0) response.warnings = cvcWarnings;
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
 *           default: 100
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
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
