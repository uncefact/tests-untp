import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { errorMessage } from '@/lib/api/errors';
import { ValidationError, validateEnum, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDid, listDids } from '@/lib/prisma/repositories';
import { CREATABLE_DID_TYPES, DidType, DidMethod, DidStatus } from '@uncefact/untp-ri-services';

/**
 * @swagger
 * /dids:
 *   post:
 *     summary: Create a new DID
 *     description: Creates a new Decentralized Identifier (DID) for the authenticated tenant
 *     tags:
 *       - DIDs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - method
 *               - alias
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [MANAGED, SELF_MANAGED]
 *                 description: Type of DID to create
 *               method:
 *                 type: string
 *                 enum: [did:web, did:key]
 *                 description: DID method to use
 *               alias:
 *                 type: string
 *                 description: Alias for the DID (e.g., domain for did:web)
 *               name:
 *                 type: string
 *                 description: Human-readable name for the DID
 *               description:
 *                 type: string
 *                 description: Description of the DID's purpose
 *               serviceInstanceId:
 *                 type: string
 *                 description: Optional service instance ID to use for DID creation
 *     responses:
 *       201:
 *         description: DID created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 did:
 *                   $ref: '#/components/schemas/Did'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
  let body: {
    type?: string;
    method?: string;
    alias?: string;
    name?: string;
    description?: string;
    serviceInstanceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const type = validateEnum(body.type, CREATABLE_DID_TYPES, 'type');
  if (!type) throw new ValidationError('type is required');

  const method = validateEnum(body.method, Object.values(DidMethod), 'method');
  if (!method) throw new ValidationError('method is required');

  if (!body.alias || typeof body.alias !== 'string') {
    throw new ValidationError('alias is required');
  }

  const { service: didService, instanceId: serviceInstanceId } = await resolveDidService(
    tenantId,
    body.serviceInstanceId,
  );

  validateEnum(type, didService.getSupportedTypes(), 'type');
  validateEnum(method, didService.getSupportedMethods(), 'method');

  let normalisedAlias: string;
  try {
    normalisedAlias = didService.normaliseAlias(body.alias, method);
  } catch (aliasErr) {
    throw new ValidationError(errorMessage(aliasErr, 'Invalid alias'));
  }

  const providerResult = await didService.create({
    type,
    method,
    alias: normalisedAlias,
    name: body.name,
    description: body.description,
  });

  const status = type === DidType.SELF_MANAGED ? DidStatus.UNVERIFIED : DidStatus.ACTIVE;

  const record = await createDid({
    tenantId,
    did: providerResult.did,
    type,
    method,
    keyId: providerResult.keyId,
    name: body.name ?? providerResult.did,
    description: body.description,
    status,
    serviceInstanceId,
  });

  return NextResponse.json({ ok: true, did: record }, { status: 201 });
});

/**
 * @swagger
 * /dids:
 *   get:
 *     summary: List DIDs
 *     description: Retrieves a list of DIDs for the authenticated tenant with optional filtering
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [MANAGED, SELF_MANAGED]
 *         description: Filter by DID type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, UNVERIFIED, VERIFIED, REVOKED]
 *         description: Filter by DID status
 *       - in: query
 *         name: serviceInstanceId
 *         schema:
 *           type: string
 *         description: Filter by service instance ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of DIDs to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of DIDs to skip for pagination
 *     responses:
 *       200:
 *         description: List of DIDs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 dids:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Did'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
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

  const type = validateEnum(url.searchParams.get('type') ?? undefined, Object.values(DidType), 'type');
  const status = validateEnum(url.searchParams.get('status') ?? undefined, Object.values(DidStatus), 'status');
  const serviceInstanceId = url.searchParams.get('serviceInstanceId') ?? undefined;
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  const dids = await listDids(tenantId, {
    type,
    status,
    serviceInstanceId,
    limit,
    offset,
  });

  return NextResponse.json({ ok: true, dids });
});
