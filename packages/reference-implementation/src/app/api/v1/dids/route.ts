import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { errorMessage, ConflictError, ForbiddenError } from '@/lib/api/errors';
import {
  ValidationError,
  validateEnum,
  parseRequestBody,
  parsePositiveInt,
  parseNonNegativeInt,
} from '@/lib/api/validation';
import { createDidRequestSchema } from '@/lib/api/request-schemas/did';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDid, listDids, findDidByAliasAndService } from '@/lib/prisma/repositories';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { DidType, DidMethod, DidStatus, DidConflictError } from '@uncefact/untp-ri-services';
import { apiLogger } from '@/lib/api/logger';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';

const logger = apiLogger.child({ route: '/api/v1/dids' });

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
 *                 enum: [DID_WEB]
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
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this DID should be the tenant's default
 *               serviceInstanceId:
 *                 type: string
 *                 description: Optional service instance ID to use for DID creation
 *     responses:
 *       201:
 *         description: DID created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Did'
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
 *       403:
 *         description: Forbidden - cannot create a root DID for the system VC service domain
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: A DID with this alias already exists on the service instance, or a DID record with this DID already exists
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
  logger.info('Parsing and validating request body');
  const body = await parseRequestBody(req, createDidRequestSchema);
  const { type, method } = body;

  logger.info({ type, method, alias: body.alias }, 'Resolving DID service');
  const { service: didService, instanceId: serviceInstanceId } = await resolveDidService(
    tenantId,
    body.serviceInstanceId,
  );

  logger.info({ serviceInstanceId }, 'Validating parameters against service capabilities');
  validateEnum(type, didService.getSupportedTypes(), 'type');
  validateEnum(method, didService.getSupportedMethods(), 'method');

  logger.info({ alias: body.alias, method }, 'Normalising alias');
  let normalisedAlias: string;
  try {
    normalisedAlias = didService.normaliseAlias(body.alias, method, type);
  } catch (aliasErr) {
    throw new ValidationError(errorMessage(aliasErr, 'Invalid alias'));
  }

  // Prevent non-system tenants from creating self-managed root DIDs that match
  // the system VCKit domain. A root did:web is one with no path segments — just
  // the domain (e.g. did:web:vckit.example.com). This stops tenants from
  // hijacking the VCKit instance's root DID.
  if (type === DidType.SELF_MANAGED && method === DidMethod.DID_WEB && tenantId !== SYSTEM_TENANT_ID) {
    const vcBaseUrl = process.env.SYSTEM_VC_BASE_URL;
    if (vcBaseUrl) {
      try {
        const vcUrl = new URL(vcBaseUrl);
        // Build both forms of the domain: with port (vckit-api:3332) and
        // without (vckit-api). Use colon separator (not %3A) to match what
        // normaliseSelfManagedAlias produces.
        const reservedDomains = [vcUrl.hostname];
        if (vcUrl.port && vcUrl.port !== '443' && vcUrl.port !== '80') {
          reservedDomains.push(`${vcUrl.hostname}:${vcUrl.port}`);
        }

        if (reservedDomains.includes(normalisedAlias)) {
          logger.warn(
            { alias: normalisedAlias, tenantId, reservedDomains },
            'Tenant attempted to create root DID for system VCKit domain',
          );
          throw new ForbiddenError(`Cannot create a root DID for the system VC service domain "${vcUrl.hostname}"`);
        }
      } catch (e) {
        if (e instanceof ForbiddenError) throw e;
        logger.warn({ vcBaseUrl, err: e }, 'SYSTEM_VC_BASE_URL is not a valid URL — root DID domain guard is disabled');
      }
    }
  }

  logger.info({ alias: normalisedAlias, serviceInstanceId }, 'Checking for duplicate DID');
  const aliasExists = await findDidByAliasAndService(normalisedAlias, serviceInstanceId);
  if (aliasExists) {
    throw new ConflictError(`A DID with alias "${normalisedAlias}" already exists on this service instance`);
  }

  logger.info({ type, method, alias: normalisedAlias, serviceInstanceId }, 'Creating DID via provider');
  let providerResult;
  try {
    providerResult = await didService.create({
      type,
      method,
      alias: normalisedAlias,
      name: body.name,
      description: body.description,
    });
  } catch (err) {
    // The upstream provider may report "already exists" even when the RI database has no record
    // — e.g. after a DB reset without resetting the provider.
    if (err instanceof DidConflictError) {
      throw new ConflictError(err.message);
    }
    throw err;
  }

  const status = type === DidType.SELF_MANAGED ? DidStatus.UNVERIFIED : DidStatus.ACTIVE;

  logger.info({ did: providerResult.did, status }, 'Saving DID record');
  const record = await createDid({
    tenantId,
    did: providerResult.did,
    type,
    method,
    keyId: providerResult.keyId,
    name: body.name ?? providerResult.did,
    description: body.description,
    isDefault: body.isDefault,
    status,
    serviceInstanceId,
  });

  logger.info({ didId: record.id, did: record.did }, 'DID created');
  return NextResponse.json(record, { status: 201 });
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
 *           enum: [DEFAULT, MANAGED, SELF_MANAGED]
 *         description: Filter by DID type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, UNVERIFIED, VERIFIED, VERIFICATION_FAILED]
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
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Did'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
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

  logger.info('Parsing query filters');
  const type = validateEnum(url.searchParams.get('type') ?? undefined, Object.values(DidType), 'type');
  const status = validateEnum(url.searchParams.get('status') ?? undefined, Object.values(DidStatus), 'status');
  const serviceInstanceId = url.searchParams.get('serviceInstanceId') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ filters: { type, status, serviceInstanceId, limit, offset } }, 'Querying DIDs from database');
  const { data, total } = await listDids(tenantId, {
    type,
    status,
    serviceInstanceId,
    limit,
    offset,
  });

  logger.info({ count: data.length }, 'DIDs listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
