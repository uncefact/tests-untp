import { NextResponse } from 'next/server';
import { NotFoundError, ConflictError, ForbiddenError } from '@/lib/api/errors';
import { assertPublicUrl, ValidationError, parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { deleteServiceQuerySchema, updateServiceRequestSchema } from '@/lib/api/request-schemas/service';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import {
  getServiceInstanceById,
  updateServiceInstance,
  deleteServiceInstance,
  countServiceInstanceReferences,
} from '@/lib/prisma/repositories';
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
 *               $ref: '#/components/schemas/ServiceInstance'
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
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ serviceInstanceId: id }, 'Looking up service instance');
  const instance = await getServiceInstanceById(id, tenantId);
  if (!instance) {
    throw new NotFoundError('Service instance not found');
  }

  logger.info({ serviceInstanceId: id }, 'Service instance retrieved');
  return NextResponse.json(maskInstanceConfig(instance, getEncryptionService(), logger));
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
 *       description: At least one recognised field is required; unknown keys are ignored.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: New name for the service instance. Cannot be empty or only whitespace
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: >-
 *                   New description for the service instance. Cannot be empty or
 *                   only whitespace; send null to clear it
 *               config:
 *                 type: object
 *                 description: >-
 *                   Configuration fields to apply. Shallow-merged onto the stored
 *                   configuration, then validated against the adapter schema and
 *                   encrypted. An explicit null is rejected; omit the field to
 *                   leave the stored configuration untouched
 *               isPrimary:
 *                 type: boolean
 *                 description: Whether this instance should be the primary for its service type
 *             anyOf:
 *               - required: [name]
 *               - required: [description]
 *               - required: [config]
 *               - required: [isPrimary]
 *     responses:
 *       200:
 *         description: Service instance updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceInstance'
 *       400:
 *         description: Validation error - invalid body or configuration
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
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ serviceInstanceId: id }, 'Parsing request body');
  const { name, description, config, isPrimary } = await parseRequestBody(req, updateServiceRequestSchema);

  const hasName = name !== undefined;
  const hasDescription = description !== undefined;
  const hasConfig = config !== undefined;
  const hasIsPrimary = isPrimary !== undefined;

  logger.info({ serviceInstanceId: id }, 'Looking up existing service instance');
  const existing = await getServiceInstanceById(id, tenantId);
  if (!existing) {
    throw new NotFoundError('Service instance not found');
  }

  let encryptedConfig: string | undefined;

  if (hasConfig) {
    logger.info({ serviceInstanceId: id }, 'Decrypting existing config');
    let existingConfig: Record<string, unknown>;
    try {
      existingConfig = JSON.parse(getEncryptionService().decrypt(JSON.parse(existing.config)));
    } catch (error) {
      logger.error({ error, serviceInstanceId: id }, 'Failed to decrypt existing config for merge');
      throw new ValidationError('Cannot update configuration: existing config could not be decrypted.');
    }

    logger.info({ serviceInstanceId: id }, 'Merging config');
    const mergedConfig = { ...existingConfig, ...config };

    logger.info({ serviceInstanceId: id }, 'Validating merged config against adapter schema');
    const { serviceType, adapterType } = existing;
    const serviceAdapters = (adapterRegistry as Record<string, Record<string, AdapterRegistryEntry> | undefined>)[
      serviceType
    ];
    const entry = serviceAdapters?.[adapterType];

    if (!entry) {
      throw new ValidationError(
        `No registered adapter '${adapterType}' for service type '${serviceType}'. Cannot validate configuration.`,
      );
    }

    const result = entry.configSchema.safeParse(mergedConfig);
    if (!result.success) {
      throw new ValidationError(`Invalid configuration: ${result.error.message}`);
    }

    // SSRF protection on merged config URLs
    if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
      if (typeof mergedConfig.baseUrl === 'string') {
        logger.info({ serviceInstanceId: id }, 'Validating config baseUrl is not internal');
        await assertPublicUrl(mergedConfig.baseUrl, 'config.baseUrl');
      }
    }

    logger.info({ serviceInstanceId: id }, 'Encrypting config');
    encryptedConfig = JSON.stringify(
      getEncryptionService().encrypt(JSON.stringify(mergedConfig), EncryptionAlgorithm.AES_256_GCM),
    );
  }

  logger.info(
    { serviceInstanceId: id, fields: { hasName, hasDescription, hasConfig, hasIsPrimary } },
    'Updating service instance',
  );

  const updated = await updateServiceInstance(id, tenantId, {
    ...(hasName && { name }),
    ...(hasDescription && { description }),
    ...(encryptedConfig !== undefined && { config: encryptedConfig }),
    ...(hasIsPrimary && { isPrimary }),
  });

  logger.info({ serviceInstanceId: id }, 'Service instance updated successfully');
  return NextResponse.json(maskInstanceConfig(updated, getEncryptionService(), logger));
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
 *       Permanently deletes a service instance. If the instance is referenced by
 *       DIDs, registrars, or identifier schemes, returns 409 Conflict unless the
 *       `force` query parameter is set to `true`. When forced, references to the instance on related records
 *       (DIDs, registrars, and identifier schemes) are cleared.
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
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: >-
 *           Set to true to delete even when other records reference this
 *           instance. Accepts exactly "true" or "false"; any other value is
 *           rejected with a 400 naming the parameter
 *     responses:
 *       204:
 *         description: Service instance deleted successfully
 *       400:
 *         description: Validation error - force is neither "true" nor "false"
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         description: >-
 *           Forbidden - either the authenticated principal has no resolvable
 *           tenant assignment, or the instance is a system default, which is
 *           readable by every tenant but deletable by none. The refusal is
 *           returned before any reference check, so no counts accompany it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               systemDefaultInstance:
 *                 summary: The instance is a system default, readable by every tenant and deletable by none
 *                 value:
 *                   error: Service instance is a system default and cannot be deleted by a tenant
 *               noTenantForUser:
 *                 summary: The authenticated user maps to no tenant
 *                 value:
 *                   error: No tenant found for user
 *       404:
 *         description: Service instance not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: >-
 *           Conflict - the caller's own DIDs, registrars or identifier schemes
 *           reference this instance. The counts name only the caller's records
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
  const { force = false } = parseQueryParams(new URL(req.url), deleteServiceQuerySchema);

  logger.info({ serviceInstanceId: id }, 'Looking up service instance for deletion');
  const existing = await getServiceInstanceById(id, tenantId);
  if (!existing) {
    throw new NotFoundError('Service instance not found');
  }

  // The lookup above admits system defaults, which every tenant can read, but
  // deleteServiceInstance only ever removes the caller's own rows. Refuse here,
  // ahead of the reference check, so a caller who cannot delete the instance
  // never receives a count of the records referencing it. A 403 rather than a
  // 404 because GET returns this same instance to this same caller, so denying
  // its existence would contradict what they have already been shown.
  if (existing.tenantId !== tenantId) {
    throw new ForbiddenError('Service instance is a system default and cannot be deleted by a tenant');
  }

  if (!force) {
    logger.info({ serviceInstanceId: id }, 'Checking for referencing records');
    const refs = await countServiceInstanceReferences(id, tenantId);
    const total = refs.dids + refs.registrars + refs.schemes;

    if (total > 0) {
      const parts: string[] = [];
      if (refs.dids > 0) parts.push(`${refs.dids} DID(s)`);
      if (refs.registrars > 0) parts.push(`${refs.registrars} registrar(s)`);
      if (refs.schemes > 0) parts.push(`${refs.schemes} identifier scheme(s)`);

      throw new ConflictError(
        `Cannot delete: service instance is referenced by ${parts.join(', ')}. ` +
          'Use ?force=true to delete anyway (references will be set to null).',
      );
    }
  }

  logger.info({ serviceInstanceId: id, force }, 'Deleting service instance');
  await deleteServiceInstance(id, tenantId);

  logger.info({ serviceInstanceId: id }, 'Service instance deleted');
  return new Response(null, { status: 204 });
});
