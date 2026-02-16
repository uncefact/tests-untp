import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { getServiceInstanceById, updateServiceInstance, deleteServiceInstance } from '@/lib/prisma/repositories';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { EncryptionAlgorithm, adapterRegistry, maskInstanceConfig } from '@uncefact/untp-ri-services';
import type { AdapterRegistryEntry } from '@uncefact/untp-ri-services';

const logger = apiLogger.child({ route: '/api/v1/services/[id]' });

// ---------------------------------------------------------------------------
// GET /api/v1/services/:id
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /services/{id}:
 *   get:
 *     summary: Get a service instance by ID
 *     description: Retrieves a specific service instance by its database ID. Configuration values are returned with sensitive fields masked.
 *     tags:
 *       - Services
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the service instance
 *     responses:
 *       200:
 *         description: Service instance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 service:
 *                   $ref: '#/components/schemas/ServiceInstance'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
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
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;
  logger.info({ tenantId, serviceInstanceId: id }, 'Looking up service instance');

  const instance = await getServiceInstanceById(id, tenantId);
  if (!instance) {
    throw new NotFoundError('Service instance not found');
  }

  return NextResponse.json({ service: maskInstanceConfig(instance, getEncryptionService()) });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/services/:id
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /services/{id}:
 *   patch:
 *     summary: Update a service instance
 *     description: Updates one or more fields of a service instance. When config is provided it is validated against the adapter's configuration schema before being encrypted and stored.
 *     tags:
 *       - Services
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the service instance
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the service instance
 *               description:
 *                 type: string
 *                 description: New description for the service instance
 *               config:
 *                 type: object
 *                 description: New configuration (plain JSON, will be validated and encrypted)
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this instance should be the primary for its service type
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Service instance updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 service:
 *                   $ref: '#/components/schemas/ServiceInstance'
 *       400:
 *         description: Validation error - invalid body or configuration
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
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  let body: { name?: string; description?: string; config?: Record<string, unknown>; isPrimary?: boolean };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const { name, description, config, isPrimary } = body;

  const hasName = name !== undefined;
  const hasDescription = description !== undefined;
  const hasConfig = config !== undefined;
  const hasIsPrimary = isPrimary !== undefined;

  if (!hasName && !hasDescription && !hasConfig && !hasIsPrimary) {
    throw new ValidationError('At least one of name, description, config, or isPrimary is required');
  }

  let encryptedConfig: string | undefined;

  if (hasConfig) {
    // Fetch existing instance to merge config
    const existing = await getServiceInstanceById(id, tenantId);
    if (!existing) {
      throw new NotFoundError('Service instance not found');
    }

    // Decrypt existing config and merge with user-supplied fields
    const existingConfig = JSON.parse(getEncryptionService().decrypt(JSON.parse(existing.config)));
    const mergedConfig = { ...existingConfig, ...config };

    // Validate the merged config against the adapter schema
    const { serviceType, adapterType } = existing;
    const serviceAdapters = (adapterRegistry as Record<string, Record<string, AdapterRegistryEntry> | undefined>)[
      serviceType
    ];
    const entry = serviceAdapters?.[adapterType];

    if (entry) {
      const result = entry.configSchema.safeParse(mergedConfig);
      if (!result.success) {
        throw new ValidationError(`Invalid configuration: ${result.error.message}`);
      }
    }

    encryptedConfig = JSON.stringify(
      getEncryptionService().encrypt(JSON.stringify(mergedConfig), EncryptionAlgorithm.AES_256_GCM),
    );
  }

  logger.info(
    { tenantId, serviceInstanceId: id, fields: { hasName, hasDescription, hasConfig, hasIsPrimary } },
    'Updating service instance',
  );

  const updated = await updateServiceInstance(id, tenantId, {
    ...(hasName && { name }),
    ...(hasDescription && { description }),
    ...(encryptedConfig !== undefined && { config: encryptedConfig }),
    ...(hasIsPrimary && { isPrimary }),
  });

  logger.info({ tenantId, serviceInstanceId: id }, 'Service instance updated');
  return NextResponse.json({ service: maskInstanceConfig(updated, getEncryptionService()) });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/services/:id
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /services/{id}:
 *   delete:
 *     summary: Delete a service instance
 *     description: >
 *       Deletes a service instance. If the instance has dependent entities
 *       (DIDs, registrars, or identifier schemes) a warning is returned
 *       and the instance is not deleted unless the `force` query parameter
 *       is set to `true`.
 *     tags:
 *       - Services
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the service instance
 *       - in: query
 *         name: force
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - 'true'
 *         description: Set to "true" to delete even when dependent entities exist
 *     responses:
 *       200:
 *         description: Service instance deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 deleted:
 *                   type: boolean
 *                   example: true
 *                 warning:
 *                   type: string
 *                   description: Present if the instance had dependent entities
 *       401:
 *         description: Unauthorised - missing or invalid authentication
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
export const DELETE = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';

  if (!force) {
    logger.warn({ tenantId, serviceInstanceId: id }, 'Delete requested without force flag');
    return NextResponse.json({
      deleted: false,
      warning: 'Use ?force=true to confirm deletion.',
    });
  }

  logger.info({ tenantId, serviceInstanceId: id }, 'Deleting service instance');
  await deleteServiceInstance(id, tenantId);

  return NextResponse.json({ deleted: true });
});
