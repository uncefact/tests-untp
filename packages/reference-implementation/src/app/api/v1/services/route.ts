import { NextResponse } from 'next/server';
import { ValidationError, validateEnum, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { createServiceInstance, listServiceInstances } from '@/lib/prisma/repositories';
import { getEncryptionService } from '@/lib/encryption/encryption';
import {
  ServiceType,
  AdapterType,
  EncryptionAlgorithm,
  adapterRegistry,
  maskInstanceConfig,
} from '@uncefact/untp-ri-services';
import type { AdapterRegistryEntry } from '@uncefact/untp-ri-services';

const logger = apiLogger.child({ route: '/api/v1/services' });

// ---------------------------------------------------------------------------
// POST /api/v1/services
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /services:
 *   post:
 *     summary: Create a new service instance
 *     description: Registers a new service instance (adapter configuration) for the authenticated tenant
 *     tags:
 *       - Services
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceType
 *               - adapterType
 *               - name
 *               - config
 *               - apiVersion
 *             properties:
 *               serviceType:
 *                 type: string
 *                 enum: [DID, IDR, STORAGE, VC]
 *                 description: The service category
 *               adapterType:
 *                 type: string
 *                 enum: [VCKIT, PYX_IDR, UNCEFACT_STORAGE]
 *                 description: The adapter implementation to use
 *               name:
 *                 type: string
 *                 description: Human-readable name for the instance
 *               description:
 *                 type: string
 *                 description: Optional description of the instance's purpose
 *               config:
 *                 type: object
 *                 description: Adapter-specific configuration (validated against the adapter schema)
 *               apiVersion:
 *                 type: string
 *                 description: Semver API version (e.g. "1.1.0")
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this instance is the primary for its service type
 *     responses:
 *       201:
 *         description: Service instance created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 serviceInstanceId:
 *                   type: string
 *                   description: Database record ID for the new service instance
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
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
    serviceType?: string;
    adapterType?: string;
    name?: string;
    description?: string;
    config?: unknown;
    apiVersion?: string;
    isPrimary?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  // --- Field validation ---------------------------------------------------

  const serviceType = validateEnum(body.serviceType, Object.values(ServiceType), 'serviceType');
  if (!serviceType) throw new ValidationError('serviceType is required');

  const adapterType = validateEnum(body.adapterType, Object.values(AdapterType), 'adapterType');
  if (!adapterType) throw new ValidationError('adapterType is required');

  if (!body.name || typeof body.name !== 'string') {
    throw new ValidationError('name is required');
  }

  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
    throw new ValidationError('config must be an object');
  }

  if (!body.apiVersion || typeof body.apiVersion !== 'string') {
    throw new ValidationError('apiVersion is required');
  }

  // --- Registry look-up & config schema validation ------------------------

  const registryForService = (adapterRegistry as Record<string, Record<string, AdapterRegistryEntry> | undefined>)[
    serviceType
  ];

  const registryEntry = registryForService?.[adapterType];

  if (!registryEntry) {
    throw new ValidationError(`Unknown adapter type '${adapterType}' for service type '${serviceType}'`);
  }

  const parseResult = registryEntry.configSchema.safeParse(body.config);
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(`Invalid config: ${messages}`);
  }

  // --- Encrypt & persist --------------------------------------------------

  const encryptedConfig = JSON.stringify(
    getEncryptionService().encrypt(JSON.stringify(body.config), EncryptionAlgorithm.AES_256_GCM),
  );

  logger.info({ tenantId, serviceType, adapterType, name: body.name }, 'Creating service instance');

  const record = await createServiceInstance({
    tenantId,
    serviceType,
    adapterType,
    name: body.name,
    description: body.description,
    config: encryptedConfig,
    apiVersion: body.apiVersion,
    isPrimary: body.isPrimary,
  });

  logger.info({ tenantId, serviceId: record.id }, 'Service instance created');

  return NextResponse.json({ serviceInstanceId: record.id }, { status: 201 });
});

// ---------------------------------------------------------------------------
// GET /api/v1/services
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /services:
 *   get:
 *     summary: List service instances
 *     description: Retrieves service instances for the authenticated tenant with optional filtering
 *     tags:
 *       - Services
 *     parameters:
 *       - in: query
 *         name: serviceType
 *         schema:
 *           type: string
 *           enum: [DID, IDR, STORAGE, VC]
 *         description: Filter by service type
 *       - in: query
 *         name: adapterType
 *         schema:
 *           type: string
 *           enum: [VCKIT, PYX_IDR, UNCEFACT_STORAGE]
 *         description: Filter by adapter type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of instances to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of instances to skip for pagination
 *     responses:
 *       200:
 *         description: List of service instances retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 services:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceInstance'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
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

  const serviceType = validateEnum(
    url.searchParams.get('serviceType') ?? undefined,
    Object.values(ServiceType),
    'serviceType',
  );
  const adapterType = validateEnum(
    url.searchParams.get('adapterType') ?? undefined,
    Object.values(AdapterType),
    'adapterType',
  );
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, filters: { serviceType, adapterType, limit, offset } }, 'Listing service instances');

  const instances = await listServiceInstances(tenantId, {
    serviceType,
    adapterType,
    limit,
    offset,
  });

  const services = instances.map((i) => maskInstanceConfig(i, getEncryptionService(), logger));

  logger.info({ tenantId, count: services.length }, 'Service instances listed');
  return NextResponse.json({ services });
});
