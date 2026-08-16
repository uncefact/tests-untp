import { NextResponse } from 'next/server';
import { assertPublicUrl, ValidationError, parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { createServiceRequestSchema, listServicesQuerySchema } from '@/lib/api/request-schemas/service';
import { createServiceInstance, listServiceInstances } from '@/lib/prisma/repositories';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { EncryptionAlgorithm, adapterRegistry, maskInstanceConfig } from '@uncefact/untp-ri-services';
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
 *             properties:
 *               serviceType:
 *                 allOf:
 *                   - $ref: '#/components/schemas/ServiceType'
 *                 description: The service category
 *               adapterType:
 *                 allOf:
 *                   - $ref: '#/components/schemas/AdapterType'
 *                 description: The adapter implementation to use
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: Human-readable name for the instance. Cannot be empty or only whitespace
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 description: >-
 *                   Optional description of the instance's purpose. Cannot be empty
 *                   or only whitespace; omit it rather than sending null
 *               config:
 *                 type: object
 *                 description: Adapter-specific configuration (validated against the adapter schema)
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this instance is the primary for its service type
 *     responses:
 *       201:
 *         description: Service instance created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceInstance'
 *       400:
 *         description: Validation error
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  logger.info('Parsing request body');
  const { serviceType, adapterType, name, description, config, isPrimary } = await parseRequestBody(
    req,
    createServiceRequestSchema,
  );

  // --- Registry look-up & config schema validation ------------------------

  logger.info({ serviceType, adapterType }, 'Looking up adapter in registry');

  const registryForService = (adapterRegistry as Record<string, Record<string, AdapterRegistryEntry> | undefined>)[
    serviceType
  ];

  const registryEntry = registryForService?.[adapterType];

  if (!registryEntry) {
    throw new ValidationError(`Unknown adapter type '${adapterType}' for service type '${serviceType}'`);
  }

  logger.info({ serviceType, adapterType }, 'Validating config against adapter schema');

  const parseResult = registryEntry.configSchema.safeParse(config);
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(`Invalid config: ${messages}`);
  }

  // --- SSRF protection on config URLs --------------------------------------

  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    if (typeof config.baseUrl === 'string') {
      logger.info('Validating config baseUrl is not internal');
      await assertPublicUrl(config.baseUrl, 'config.baseUrl');
    }
  }

  // --- Encrypt & persist --------------------------------------------------

  logger.info({ serviceType, adapterType, name }, 'Encrypting and persisting service instance');

  const encryptedConfig = JSON.stringify(
    getEncryptionService().encrypt(JSON.stringify(config), EncryptionAlgorithm.AES_256_GCM),
  );

  const record = await createServiceInstance({
    tenantId,
    serviceType,
    adapterType,
    name,
    description,
    config: encryptedConfig,
    isPrimary,
  });

  const masked = maskInstanceConfig(record, getEncryptionService(), logger);

  logger.info({ serviceInstanceId: record.id }, 'Service instance created');
  return NextResponse.json(masked, { status: 201 });
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
 *           $ref: '#/components/schemas/ServiceType'
 *         description: Filter by service type
 *       - in: query
 *         name: adapterType
 *         schema:
 *           $ref: '#/components/schemas/AdapterType'
 *         description: Filter by adapter type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: >-
 *           Maximum number of instances to return. A value above the configured
 *           maximum is rejected with a 400 naming the maximum.
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
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceInstance'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error
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
  logger.info('Parsing and validating query filters');

  const { serviceType, adapterType, limit, offset } = parseQueryParams(new URL(req.url), listServicesQuerySchema);

  logger.info({ filters: { serviceType, adapterType, limit, offset } }, 'Querying service instances');

  const { data, total } = await listServiceInstances(tenantId, {
    serviceType,
    adapterType,
    limit,
    offset,
  });

  logger.info('Masking service instance configurations');
  const masked = data.map((i) => maskInstanceConfig(i, getEncryptionService(), logger));

  logger.info({ count: masked.length }, 'Service instances listed');
  return NextResponse.json(buildPaginatedResponse(masked, total, limit, offset));
});
