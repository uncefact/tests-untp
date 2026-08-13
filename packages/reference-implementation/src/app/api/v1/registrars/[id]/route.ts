import { NextResponse } from 'next/server';
import { ServiceType } from '@uncefact/untp-ri-services';
import { NotFoundError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { parseRequestBody, definedFields, assertHttpUrl, assertPublicUrl } from '@/lib/api/validation';
import { updateRegistrarRequestSchema } from '@/lib/api/request-schemas/registrar';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getInstanceByResolution, getRegistrarById, updateRegistrar, deleteRegistrar } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/registrars/[id]' });

/**
 * @swagger
 * /registrars/{id}:
 *   get:
 *     summary: Get a registrar by ID
 *     description: Retrieves a specific registrar by its database ID
 *     tags:
 *       - Registrars
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the registrar
 *     responses:
 *       200:
 *         description: Registrar retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Registrar'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Registrar not found
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
  logger.info({ registrarId: id }, 'Looking up registrar');
  const registrar = await getRegistrarById(id, tenantId);
  if (!registrar) {
    throw new NotFoundError('Registrar not found');
  }
  logger.info({ registrarId: id }, 'Registrar retrieved');
  return NextResponse.json(registrar);
});

/**
 * @swagger
 * /registrars/{id}:
 *   patch:
 *     summary: Update a registrar
 *     description: Updates the fields of a specific registrar
 *     tags:
 *       - Registrars
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the registrar
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
 *                 description: New name for the registrar. Must contain at least one non-whitespace character; an explicit null is rejected with a 400.
 *               namespace:
 *                 type: string
 *                 minLength: 1
 *                 description: New namespace for the registrar. Must contain at least one non-whitespace character; an explicit null is rejected with a 400.
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: A valid public http(s) URL for the registrar's website. Rejected with a 400 if it is not a valid, public http(s) URL, if it carries leading or trailing whitespace, or if it is an explicit null.
 *               idrServiceInstanceId:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: New IDR service instance ID (set to null to clear). Must reference a service instance the tenant can use (its own, or a system default); otherwise the request is rejected with a 404.
 *             anyOf:
 *               - required: [name]
 *               - required: [namespace]
 *               - required: [url]
 *               - required: [idrServiceInstanceId]
 *     responses:
 *       200:
 *         description: Registrar updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Registrar'
 *       400:
 *         description: Validation error (e.g. no recognised fields provided, a blank name or namespace, a url that is not a valid public http(s) URL)
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
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Registrar or IDR service instance not found
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
  logger.info({ registrarId: id }, 'Validating update fields');

  const body = await parseRequestBody(req, updateRegistrarRequestSchema);
  const fields = definedFields(body);

  // Same stored-URL layer as POST (see route.ts): the schema's `.url()` is
  // format-only, so a provided url still needs the scheme/userinfo and SSRF
  // checks here before it reaches the repository. Also stores the value
  // verbatim rather than assertHttpUrl's canonical `.href`, for the same
  // reason recorded in route.ts (no parser-differential gap to close here,
  // nothing dereferences registrar.url server-side, canonicalising would
  // mutate stored data); revisit before any server-side dereference of
  // registrar.url is introduced.
  if (fields.url !== undefined) {
    assertHttpUrl(fields.url, 'url');
    if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
      logger.info({ registrarId: id }, 'Validating registrar URL is not internal');
      await assertPublicUrl(fields.url, 'url');
    }
  }

  // Same boundary check as POST (see route.ts): the row's foreign key only
  // proves the instance exists globally, so a tenant-scoped lookup is needed
  // to keep another tenant's instance id from being stored. A null skips the
  // check because it clears the linkage rather than referencing anything.
  if (typeof fields.idrServiceInstanceId === 'string') {
    logger.info(
      { registrarId: id, idrServiceInstanceId: fields.idrServiceInstanceId },
      'Verifying IDR service instance is accessible to this tenant',
    );
    const instance = await getInstanceByResolution(tenantId, ServiceType.IDR, fields.idrServiceInstanceId);
    if (!instance) {
      throw new ServiceInstanceNotFoundError(fields.idrServiceInstanceId);
    }
  }

  logger.info({ registrarId: id, fields: Object.keys(fields) }, 'Updating registrar');
  const updated = await updateRegistrar(id, tenantId, fields);

  logger.info({ registrarId: id }, 'Registrar updated');
  return NextResponse.json(updated);
});

/**
 * @swagger
 * /registrars/{id}:
 *   delete:
 *     summary: Delete a registrar
 *     description: Deletes a specific registrar by its database ID
 *     tags:
 *       - Registrars
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the registrar
 *     responses:
 *       204:
 *         description: Registrar deleted successfully
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - authenticated principal has no resolvable tenant assignment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Registrar not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The registrar has schemes with identifiers and cannot be deleted
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
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ registrarId: id }, 'Deleting registrar');
  await deleteRegistrar(id, tenantId);

  logger.info({ registrarId: id }, 'Registrar deleted');
  return new Response(null, { status: 204 });
});
