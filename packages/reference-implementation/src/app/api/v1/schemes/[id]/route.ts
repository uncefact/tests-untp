import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierSchemeById, updateIdentifierScheme, deleteIdentifierScheme } from '@/lib/prisma/repositories';

/**
 * @swagger
 * /schemes/{id}:
 *   get:
 *     summary: Get an identifier scheme by ID
 *     description: Retrieves a specific identifier scheme by its database ID
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     responses:
 *       200:
 *         description: Scheme retrieved successfully
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
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Scheme not found
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
    const scheme = await getIdentifierSchemeById(id, tenantId);
    if (!scheme) {
      throw new NotFoundError('Identifier scheme not found');
    }
    return NextResponse.json({ ok: true, scheme });
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
 * /schemes/{id}:
 *   patch:
 *     summary: Update an identifier scheme
 *     description: Updates the fields of a specific identifier scheme. When qualifiers are provided, existing qualifiers are replaced entirely.
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the scheme
 *               primaryKey:
 *                 type: string
 *                 description: New primary key identifier
 *               validationPattern:
 *                 type: string
 *                 description: New validation pattern
 *               namespace:
 *                 type: string
 *                 description: New namespace
 *               idrServiceInstanceId:
 *                 type: string
 *                 nullable: true
 *                 description: New IDR service instance ID (set to null to clear)
 *               qualifiers:
 *                 type: array
 *                 description: Replacement qualifiers (replaces all existing qualifiers)
 *                 items:
 *                   type: object
 *                   required:
 *                     - key
 *                     - description
 *                     - validationPattern
 *                   properties:
 *                     key:
 *                       type: string
 *                     description:
 *                       type: string
 *                     validationPattern:
 *                       type: string
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: Scheme updated successfully
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
 *         description: Scheme not found
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
    primaryKey?: string;
    validationPattern?: string;
    namespace?: string;
    idrServiceInstanceId?: string | null;
    qualifiers?: Array<{
      key: string;
      description: string;
      validationPattern: string;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const hasName = isNonEmptyString(body.name);
  const hasPrimaryKey = isNonEmptyString(body.primaryKey);
  const hasValidationPattern = isNonEmptyString(body.validationPattern);
  const hasNamespace = isNonEmptyString(body.namespace);
  const hasIdrServiceInstanceId = body.idrServiceInstanceId !== undefined;
  const hasQualifiers = body.qualifiers !== undefined;

  if (
    !hasName &&
    !hasPrimaryKey &&
    !hasValidationPattern &&
    !hasNamespace &&
    !hasIdrServiceInstanceId &&
    !hasQualifiers
  ) {
    return NextResponse.json({ ok: false, error: 'At least one field is required' }, { status: 400 });
  }

  try {
    // Validate qualifiers if provided
    if (hasQualifiers) {
      if (!Array.isArray(body.qualifiers)) {
        throw new ValidationError('qualifiers must be an array');
      }
      for (const q of body.qualifiers!) {
        if (!isNonEmptyString(q.key)) throw new ValidationError('qualifier key is required');
        if (!isNonEmptyString(q.description)) throw new ValidationError('qualifier description is required');
        if (!isNonEmptyString(q.validationPattern))
          throw new ValidationError('qualifier validationPattern is required');
      }
    }

    const updated = await updateIdentifierScheme(id, tenantId, {
      ...(hasName && { name: body.name }),
      ...(hasPrimaryKey && { primaryKey: body.primaryKey }),
      ...(hasValidationPattern && { validationPattern: body.validationPattern }),
      ...(hasNamespace && { namespace: body.namespace }),
      ...(hasIdrServiceInstanceId && { idrServiceInstanceId: body.idrServiceInstanceId }),
      ...(hasQualifiers && { qualifiers: body.qualifiers }),
    });

    return NextResponse.json({ ok: true, scheme: updated });
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
 * /schemes/{id}:
 *   delete:
 *     summary: Delete an identifier scheme
 *     description: Deletes a specific identifier scheme by its database ID
 *     tags:
 *       - Schemes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     responses:
 *       200:
 *         description: Scheme deleted successfully
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
 *         description: Scheme not found
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
    await deleteIdentifierScheme(id, tenantId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
