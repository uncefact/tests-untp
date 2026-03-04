import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { resolveDataModel, isDccDataModel } from '@/lib/credentials/resolve-data-model';
import { validateCredentialPayload } from '@/lib/credentials/validate-credential-payload';
import { issueCredential } from '@/lib/credentials/issue-credential';
import { updateCredentialPublished } from '@/lib/prisma/repositories';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { buildPublishLinks } from '@uncefact/untp-ri-services';
import { CredentialType } from '@/lib/prisma/generated';
import type { CredentialPayload, ICvcAwareMapper } from '@uncefact/untp-ri-services';
import { validateCvcCompliance } from '@/lib/services/cvc-validation.service';
import type { CvcValidationWarning } from '@/lib/services/cvc-validation.service';

const logger = apiLogger.child({ route: '/api/v1/credentials' });

/** Valid credential type strings (must match Prisma CredentialType enum). */
const VALID_CREDENTIAL_TYPES = Object.values(CredentialType) as string[];

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

  if (!VALID_CREDENTIAL_TYPES.includes(body.credentialType)) {
    throw new ValidationError(`credentialType must be one of: ${VALID_CREDENTIAL_TYPES.join(', ')}`);
  }

  if (!isNonEmptyString(body.version)) {
    throw new ValidationError('version is required');
  }

  const { credentialPayload, credentialType, version } = body;
  const signingOptions = body.signingOptions ?? {};
  const storageOptions = body.storageOptions ?? {};
  const publishingOptions = body.publishingOptions ?? {};

  // ── Step 2: Resolve data model ──────────────────────────────────────────

  const { dataModel, mapper, schemaUrls } = await resolveDataModel(tenantId, credentialType, version);

  // ── Step 3: Validate payload ────────────────────────────────────────────

  await validateCredentialPayload(credentialPayload, schemaUrls);

  // ── Step 3.5: CVC validation (advisory) ─────────────────────────────

  let cvcWarnings: CvcValidationWarning[] = [];

  if (isDccDataModel(dataModel)) {
    if ('extractCvcRefs' in mapper) {
      try {
        const cvcRefs = (mapper as ICvcAwareMapper).extractCvcRefs(credentialPayload);
        const result = await validateCvcCompliance(tenantId, cvcRefs);
        cvcWarnings = result.warnings;
      } catch (error) {
        logger.warn({ error }, 'CVC validation failed — continuing without CVC checks');
        cvcWarnings = [
          {
            code: 'CVC_VALIDATION_ERROR',
            message: 'CVC validation could not be performed — credential was issued without CVC checks',
          },
        ];
      }
    } else {
      logger.warn(
        { tenantId, credentialType, version },
        'DCC mapper does not implement extractCvcRefs — skipping CVC validation',
      );
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
    mapper,
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
