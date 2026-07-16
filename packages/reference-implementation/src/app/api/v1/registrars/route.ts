import { NextResponse } from 'next/server';
import { parseRequestBody, parseQueryParams, assertHttpUrl, assertPublicUrl } from '@/lib/api/validation';
import { createRegistrarRequestSchema, listRegistrarsQuerySchema } from '@/lib/api/request-schemas/registrar';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createRegistrar, listRegistrars } from '@/lib/prisma/repositories';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/registrars' });

/**
 * @swagger
 * /registrars:
 *   post:
 *     summary: Create a new registrar
 *     description: Creates a new registrar for the authenticated tenant
 *     tags:
 *       - Registrars
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - namespace
 *               - url
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 description: Human-readable name for the registrar
 *               namespace:
 *                 type: string
 *                 minLength: 1
 *                 description: Namespace for the registrar (e.g. "gs1")
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: A valid public http(s) URL for the registrar's website. Rejected with a 400 if it is not a valid, public http(s) URL.
 *               idrServiceInstanceId:
 *                 type: string
 *                 minLength: 1
 *                 description: Optional IDR service instance ID
 *     responses:
 *       201:
 *         description: Registrar created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Registrar'
 *       400:
 *         description: Validation error (e.g. missing required field, a url that is not a valid public http(s) URL, an idrServiceInstanceId that does not reference an existing service instance)
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId }) => {
  logger.info('Validating request body');
  const body = await parseRequestBody(req, createRegistrarRequestSchema);

  // The schema's `.url()` above is WHATWG `new URL` parsing (format only, not
  // RFC 3986 validation), so it does not require http(s), reject userinfo, or
  // check the address is public. assertHttpUrl further requires an absolute
  // http(s) scheme and rejects embedded userinfo; assertPublicUrl (unless
  // VERIFY_ALLOW_PRIVATE_URLS relaxes it for local development) rejects a
  // private or unresolvable address. Mirrors the stored-URL validation layer
  // credentials/route.ts applies to its own URL fields (ADR-037);
  // data-models/route.ts applies only the env-gated assertPublicUrl today.
  assertHttpUrl(body.url, 'url');
  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    logger.info('Validating registrar URL is not internal');
    await assertPublicUrl(body.url, 'url');
  }

  // Stores the submitted url verbatim rather than assertHttpUrl's canonical
  // `.href`: both checks above already share one WHATWG parser (no
  // parser-differential gap to close), and nothing in this repo dereferences
  // registrar.url server-side, so there is no SSRF benefit to canonicalising
  // here. Canonicalising would also mutate stored data (e.g. `new
  // URL('https://gs1.org').href` adds a trailing slash), which the
  // valid-inputs-unchanged behaviour this ticket promises does not cover.
  // Revisit this (switch to storing the canonical `.href`) before any
  // server-side dereference of registrar.url is introduced.
  logger.info({ namespace: body.namespace }, 'Creating registrar');
  const registrar = await createRegistrar({
    tenantId,
    name: body.name,
    namespace: body.namespace,
    url: body.url,
    idrServiceInstanceId: body.idrServiceInstanceId,
  });

  logger.info({ registrarId: registrar.id }, 'Registrar created');
  return NextResponse.json(registrar, { status: 201 });
});

/**
 * @swagger
 * /registrars:
 *   get:
 *     summary: List registrars
 *     description: Retrieves a list of registrars for the authenticated tenant
 *     tags:
 *       - Registrars
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of registrars to return per page. Defaults to 20, or the configured maximum when it is lower. A larger value is rejected with a 400 naming the maximum.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of registrars to skip for pagination
 *     responses:
 *       200:
 *         description: List of registrars retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Registrar'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error (e.g. a limit above the maximum, a repeated query parameter)
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  logger.info('Parsing query parameters');
  const { limit, offset } = parseQueryParams(new URL(req.url), listRegistrarsQuerySchema);

  logger.info({ limit, offset }, 'Listing registrars');
  const { data, total } = await listRegistrars(tenantId, { limit, offset });

  logger.info({ count: data.length, total }, 'Registrars listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
