import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createRegistrar, listRegistrars } from '@/lib/prisma/repositories';

/**
 * @swagger
 * /registrars:
 *   post:
 *     summary: Create a new registrar
 *     description: Creates a new identifier registrar for the authenticated tenant
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
 *             properties:
 *               name:
 *                 type: string
 *                 description: Human-readable name for the registrar
 *               namespace:
 *                 type: string
 *                 description: Namespace for the registrar (e.g. "gs1")
 *               url:
 *                 type: string
 *                 description: URL of the registrar
 *               idrServiceInstanceId:
 *                 type: string
 *                 description: Optional IDR service instance ID
 *     responses:
 *       201:
 *         description: Registrar created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 registrar:
 *                   $ref: '#/components/schemas/Registrar'
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
    name?: string;
    namespace?: string;
    url?: string;
    idrServiceInstanceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if (!isNonEmptyString(body.name)) throw new ValidationError('name is required');
    if (!isNonEmptyString(body.namespace)) throw new ValidationError('namespace is required');

    const registrar = await createRegistrar({
      tenantId,
      name: body.name,
      namespace: body.namespace,
      url: body.url,
      idrServiceInstanceId: body.idrServiceInstanceId,
    });

    return NextResponse.json({ ok: true, registrar }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
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
 *         description: Maximum number of registrars to return
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
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 registrars:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Registrar'
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

  try {
    const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
    const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

    const registrars = await listRegistrars(tenantId, { limit, offset });

    return NextResponse.json({ ok: true, registrars });
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
