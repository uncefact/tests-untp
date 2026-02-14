import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createIdentifierScheme, listIdentifierSchemes } from '@/lib/prisma/repositories';

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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - registrarId
 *               - name
 *               - primaryKey
 *               - validationPattern
 *             properties:
 *               registrarId:
 *                 type: string
 *                 description: ID of the parent registrar
 *               name:
 *                 type: string
 *                 description: Human-readable name for the scheme
 *               primaryKey:
 *                 type: string
 *                 description: Primary key identifier (e.g. "gtin", "sscc")
 *               validationPattern:
 *                 type: string
 *                 description: Regular expression pattern for validating identifier values
 *               namespace:
 *                 type: string
 *                 description: Optional namespace for the scheme
 *               idrServiceInstanceId:
 *                 type: string
 *                 description: Optional IDR service instance ID
 *               qualifiers:
 *                 type: array
 *                 description: Optional list of qualifier definitions
 *                 items:
 *                   type: object
 *                   required:
 *                     - key
 *                     - description
 *                   properties:
 *                     key:
 *                       type: string
 *                     description:
 *                       type: string
 *                     validationPattern:
 *                       type: string
 *     responses:
 *       201:
 *         description: Scheme created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 scheme:
 *                   $ref: '#/components/schemas/IdentifierScheme'
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: {
    registrarId?: string;
    name?: string;
    primaryKey?: string;
    validationPattern?: string;
    namespace?: string;
    idrServiceInstanceId?: string;
    qualifiers?: Array<{
      key: string;
      description: string;
      validationPattern?: string;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if (!isNonEmptyString(body.registrarId)) throw new ValidationError('registrarId is required');
    if (!isNonEmptyString(body.name)) throw new ValidationError('name is required');
    if (!isNonEmptyString(body.primaryKey)) throw new ValidationError('primaryKey is required');
    if (!isNonEmptyString(body.validationPattern)) throw new ValidationError('validationPattern is required');

    // Validate qualifiers if provided
    if (body.qualifiers !== undefined) {
      if (!Array.isArray(body.qualifiers)) {
        throw new ValidationError('qualifiers must be an array');
      }
      for (const q of body.qualifiers) {
        if (!isNonEmptyString(q.key)) throw new ValidationError('qualifier key is required');
        if (!isNonEmptyString(q.description)) throw new ValidationError('qualifier description is required');
      }
    }

    const scheme = await createIdentifierScheme({
      tenantId,
      registrarId: body.registrarId,
      name: body.name,
      primaryKey: body.primaryKey,
      validationPattern: body.validationPattern,
      namespace: body.namespace,
      idrServiceInstanceId: body.idrServiceInstanceId,
      qualifiers: body.qualifiers,
    });

    return NextResponse.json({ ok: true, scheme }, { status: 201 });
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
 *         description: Filter by registrar ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of schemes to return
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
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 schemes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/IdentifierScheme'
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
    const registrarId = url.searchParams.get('registrarId') ?? undefined;
    const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
    const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

    const schemes = await listIdentifierSchemes(tenantId, { registrarId, limit, offset });

    return NextResponse.json({ ok: true, schemes });
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
