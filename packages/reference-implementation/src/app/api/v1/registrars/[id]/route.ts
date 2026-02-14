import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getRegistrarById, updateRegistrar, deleteRegistrar } from '@/lib/prisma/repositories';

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
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 registrar:
 *                   $ref: '#/components/schemas/Registrar'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
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

  try {
    const registrar = await getRegistrarById(id, tenantId);
    if (!registrar) {
      throw new NotFoundError('Registrar not found');
    }
    return NextResponse.json({ ok: true, registrar });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the registrar
 *               namespace:
 *                 type: string
 *                 description: New namespace for the registrar
 *               url:
 *                 type: string
 *                 description: New URL for the registrar
 *               idrServiceInstanceId:
 *                 type: string
 *                 nullable: true
 *                 description: New IDR service instance ID (set to null to clear)
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Registrar updated successfully
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
 *         description: Validation error - at least one field required
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
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  let body: {
    name?: string;
    namespace?: string;
    url?: string;
    idrServiceInstanceId?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const hasName = isNonEmptyString(body.name);
  const hasNamespace = isNonEmptyString(body.namespace);
  const hasUrl = isNonEmptyString(body.url);
  const hasIdrServiceInstanceId = body.idrServiceInstanceId !== undefined;

  if (!hasName && !hasNamespace && !hasUrl && !hasIdrServiceInstanceId) {
    return NextResponse.json(
      { ok: false, error: 'At least one of name, namespace, url, or idrServiceInstanceId is required' },
      { status: 400 },
    );
  }

  try {
    const updated = await updateRegistrar(id, tenantId, {
      ...(hasName && { name: body.name }),
      ...(hasNamespace && { namespace: body.namespace }),
      ...(hasUrl && { url: body.url }),
      ...(hasIdrServiceInstanceId && { idrServiceInstanceId: body.idrServiceInstanceId }),
    });
    return NextResponse.json({ ok: true, registrar: updated });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
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
 *       200:
 *         description: Registrar deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Unauthorised - missing or invalid authentication
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
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  try {
    await deleteRegistrar(id, tenantId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
