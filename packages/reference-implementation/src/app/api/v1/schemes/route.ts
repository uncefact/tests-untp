import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createIdentifierScheme, listIdentifierSchemes } from '@/lib/prisma/repositories';
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
 *                     - validationPattern
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
      validationPattern: string;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

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
      if (!isNonEmptyString(q.validationPattern)) throw new ValidationError('qualifier validationPattern is required');
    }
  }

  logger.info(
    {
      tenantId,
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
    namespace: body.namespace,
    idrServiceInstanceId: body.idrServiceInstanceId,
    qualifiers: body.qualifiers,
  });

  logger.info({ tenantId, schemeId: scheme.id }, 'Scheme created');
  return NextResponse.json({ ok: true, scheme }, { status: 201 });
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
  const registrarId = url.searchParams.get('registrarId') ?? undefined;
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, registrarId, limit, offset }, 'Listing schemes');
  const schemes = await listIdentifierSchemes(tenantId, { registrarId, limit, offset });

  logger.info({ tenantId, count: schemes.length }, 'Schemes listed');
  return NextResponse.json({ ok: true, schemes });
});
