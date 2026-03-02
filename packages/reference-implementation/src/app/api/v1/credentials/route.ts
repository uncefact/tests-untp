import { NextResponse } from 'next/server';
import { ValidationError } from '@/lib/api/validation';
import { UnprocessableError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { createCredential, getDidByDid } from '@/lib/prisma/repositories';
import { ISSUABLE_DID_STATUSES } from '@uncefact/untp-ri-services';
import type { CredentialPayload } from '@uncefact/untp-ri-services';

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
 *       Signs a credential payload, stores the enveloped credential (optionally
 *       encrypted), optionally publishes it to the Identity Resolver, and returns
 *       the credential ID.
 *     tags:
 *       - Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credentialPayload
 *             properties:
 *               credentialPayload:
 *                 type: object
 *                 description: The credential payload to sign (must include issuer, credentialSubject, etc.)
 *               encrypt:
 *                 type: boolean
 *                 description: Whether to encrypt the credential in storage (default true)
 *               publish:
 *                 type: boolean
 *                 description: Whether to publish the credential to the Identity Resolver (default false)
 *               vcServiceInstanceId:
 *                 type: string
 *                 description: Optional VC service instance ID (falls back to tenant primary or system default)
 *               storageServiceInstanceId:
 *                 type: string
 *                 description: Optional storage service instance ID (falls back to tenant primary or system default)
 *               idrServiceInstanceId:
 *                 type: string
 *                 description: Optional IDR service instance ID for publishing (falls back to tenant primary or system default)
 *     responses:
 *       201:
 *         description: Credential issued, stored, and optionally published
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 credentialId:
 *                   type: string
 *                   description: Database record ID for the credential
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised — missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Issuer DID is not registered for this tenant or not in an issuable status (ACTIVE or VERIFIED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error during credential issuance
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: {
    credentialPayload?: CredentialPayload;
    encrypt?: boolean;
    publish?: boolean;
    vcServiceInstanceId?: string;
    storageServiceInstanceId?: string;
    idrServiceInstanceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (!body.credentialPayload || typeof body.credentialPayload !== 'object') {
    throw new ValidationError('credentialPayload is required and must be an object');
  }

  const issuerDid = body.credentialPayload.issuer?.id;
  if (!issuerDid || typeof issuerDid !== 'string') {
    throw new ValidationError('credentialPayload.issuer.id is required');
  }

  logger.info({ tenantId, issuerDid }, 'Verifying issuer DID is registered and issuable');
  const didRecord = await getDidByDid(issuerDid, tenantId);
  if (!didRecord) {
    throw new UnprocessableError('Issuer DID is not registered for this tenant');
  }
  if (!ISSUABLE_DID_STATUSES.includes(didRecord.status as (typeof ISSUABLE_DID_STATUSES)[number])) {
    throw new UnprocessableError(
      `Issuer DID status (${didRecord.status}) is not eligible for credential issuance. DID must be ACTIVE or VERIFIED.`,
    );
  }

  const shouldEncrypt = body.encrypt !== false;
  const shouldPublish = body.publish === true;

  const { service: vcService, instanceId: vcInstanceId } = await resolveVcService(tenantId, body.vcServiceInstanceId);
  logger.info({ tenantId, vcInstanceId }, 'Signing credential');
  const signedCredential = await vcService.sign(body.credentialPayload);

  const { service: storageService, instanceId: storageInstanceId } = await resolveStorageService(
    tenantId,
    body.storageServiceInstanceId,
  );
  logger.info({ tenantId, storageInstanceId, shouldEncrypt }, 'Storing credential');
  const storageResponse = await storageService.store(signedCredential, shouldEncrypt);

  if (shouldPublish) {
    const { service: _idrService, instanceId: idrInstanceId } = await resolveIdrService(
      tenantId,
      body.idrServiceInstanceId,
    );
    logger.info({ tenantId, idrInstanceId }, 'Publishing credential to IDR');
    // TODO: Wire up publishCredential via credential type mapper service
  }

  // TODO: Derive credentialType from credential payload via credential type mapper service
  const credentialType = 'VerifiableCredential';

  const credentialRecord = await createCredential({
    tenantId,
    storageUri: storageResponse.uri,
    hash: storageResponse.hash,
    decryptionKey: storageResponse.decryptionKey,
    credentialType,
    isPublished: false, // Always false until publishCredential is wired up
  });

  logger.info(
    { tenantId, credentialId: credentialRecord.id, published: shouldPublish },
    'Credential issued and stored',
  );

  return NextResponse.json({ credentialId: credentialRecord.id }, { status: 201 });
});
