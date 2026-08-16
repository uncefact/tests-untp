import { NextResponse } from 'next/server';
import { ServiceType } from '@uncefact/untp-ri-services';
import { parseRequestBody, parseQueryParams } from '@/lib/api/validation';
import { createSchemeRequestSchema, listSchemesQuerySchema } from '@/lib/api/request-schemas/scheme';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import {
  createIdentifierScheme,
  getInstanceByResolution,
  getRegistrarById,
  listIdentifierSchemes,
} from '@/lib/prisma/repositories';
import { NotFoundError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/schemes' });

/**
 * @swagger
 * /schemes:
 *   post:
 *     summary: Create a new identifier scheme
 *     description: Creates a new identifier scheme with optional nested qualifiers for the authenticated tenant
 *     tags:
 *       - Schemes
 *     requestBody:
 *       required: true
 *       description: Required text fields must contain at least one non-whitespace character; a whitespace-only value is rejected with a 400.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - registrarId
 *               - name
 *               - primaryKey
 *               - validationPattern
 *               - linkTemplate
 *             properties:
 *               registrarId:
 *                 type: string
 *                 minLength: 1
 *                 description: ID of the parent registrar
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: Human-readable name for the scheme
 *               primaryKey:
 *                 type: string
 *                 minLength: 1
 *                 description: Primary key identifier (e.g. "gtin", "sscc")
 *               validationPattern:
 *                 type: string
 *                 minLength: 1
 *                 description: Regular expression pattern for validating identifier values. Rejected with a 400 if it does not compile as a regular expression.
 *               linkTemplate:
 *                 type: string
 *                 minLength: 1
 *                 description: ISO 18975 link template for URI construction (e.g. "/{primaryKey}/{value}")
 *               idrServiceInstanceId:
 *                 type: string
 *                 minLength: 1
 *                 description: Optional IDR service instance ID. Must reference a service instance the tenant can use (its own, or a system default); otherwise the request is rejected with a 404.
 *               qualifiers:
 *                 type: array
 *                 description: Optional list of qualifier definitions
 *                 items:
 *                   type: object
 *                   required:
 *                     - key
 *                     - description
 *                     - validationPattern
 *                   properties:
 *                     key:
 *                       type: string
 *                       minLength: 1
 *                     description:
 *                       type: string
 *                       minLength: 1
 *                     validationPattern:
 *                       type: string
 *                       minLength: 1
 *                       description: Rejected with a 400 if it does not compile as a regular expression.
 *                     order:
 *                       type: integer
 *                       format: int32
 *                       minimum: 0
 *                       maximum: 2147483647
 *                       description: Qualifier precedence in URI ordering (ascending). Defaults to 0.
 *     responses:
 *       201:
 *         description: Scheme created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IdentifierScheme'
 *       400:
 *         description: Validation error (e.g. a missing or blank required field, a validationPattern that does not compile as a regular expression, a duplicate qualifier key)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       404:
 *         description: Registrar or IDR service instance not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An identifier scheme with this primary key already exists for the registrar
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
  logger.info('Validating request body');
  const body = await parseRequestBody(req, createSchemeRequestSchema);

  // Verify the registrar exists and belongs to this tenant
  const registrar = await getRegistrarById(body.registrarId, tenantId);
  if (!registrar) {
    throw new NotFoundError('Registrar not found');
  }

  // Same boundary check as the registrars routes: the scheme row's foreign
  // key on idrServiceInstanceId proves only that the instance exists
  // globally, so a tenant-scoped, type-filtered lookup is needed to keep
  // another tenant's (or a non-IDR) instance id from being stored.
  if (body.idrServiceInstanceId !== undefined) {
    logger.info(
      { idrServiceInstanceId: body.idrServiceInstanceId },
      'Verifying IDR service instance is accessible to this tenant',
    );
    const instance = await getInstanceByResolution(tenantId, ServiceType.IDR, body.idrServiceInstanceId);
    if (!instance) {
      throw new ServiceInstanceNotFoundError(body.idrServiceInstanceId);
    }
  }

  logger.info(
    {
      registrarId: body.registrarId,
      primaryKey: body.primaryKey,
      qualifierCount: body.qualifiers?.length ?? 0,
    },
    'Creating identifier scheme',
  );
  const scheme = await createIdentifierScheme({
    tenantId,
    registrarId: body.registrarId,
    name: body.name,
    primaryKey: body.primaryKey,
    validationPattern: body.validationPattern,
    linkTemplate: body.linkTemplate,
    idrServiceInstanceId: body.idrServiceInstanceId,
    qualifiers: body.qualifiers,
  });

  logger.info({ schemeId: scheme.id }, 'Scheme created');
  return NextResponse.json(scheme, { status: 201 });
});

/**
 * @swagger
 * /schemes:
 *   get:
 *     summary: List identifier schemes
 *     description: Retrieves a list of identifier schemes for the authenticated tenant with optional filtering
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: query
 *         name: registrarId
 *         schema:
 *           type: string
 *           minLength: 1
 *         description: Filter by registrar ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of schemes to return per page. Defaults to 20, or the configured maximum when it is lower. A larger value is rejected with a 400 naming the maximum.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of schemes to skip for pagination
 *     responses:
 *       200:
 *         description: List of schemes retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/IdentifierScheme'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error (e.g. a limit above the maximum, a repeated query parameter, an empty registrarId filter)
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
  logger.info('Parsing query parameters');
  const query = parseQueryParams(new URL(req.url), listSchemesQuerySchema);
  const { registrarId, limit, offset } = query;

  logger.info({ registrarId, limit, offset }, 'Listing schemes');
  const { data, total } = await listIdentifierSchemes(tenantId, { registrarId, limit, offset });

  logger.info({ count: data.length }, 'Schemes listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
