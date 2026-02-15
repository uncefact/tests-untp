import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createIdentifier, listIdentifiers } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/identifiers' });

/**
 * @swagger
 * /identifiers:
 *   post:
 *     summary: Create a new identifier
 *     description: Creates a new identifier after validating the value against the scheme's validation pattern
 *     tags:
 *       - Identifiers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - schemeId
 *               - value
 *             properties:
 *               schemeId:
 *                 type: string
 *                 description: ID of the identifier scheme
 *               value:
 *                 type: string
 *                 description: The identifier value (validated against scheme pattern)
 *     responses:
 *       201:
 *         description: Identifier created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 identifier:
 *                   $ref: '#/components/schemas/Identifier'
 *       400:
 *         description: Validation error (e.g. value does not match scheme pattern)
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
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: {
    schemeId?: string;
    value?: string;
  };

  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (!isNonEmptyString(body.schemeId)) throw new ValidationError('schemeId is required');
  if (!isNonEmptyString(body.value)) throw new ValidationError('value is required');

  logger.info({ tenantId, schemeId: body.schemeId }, 'Creating identifier');
  const identifier = await createIdentifier({
    tenantId,
    schemeId: body.schemeId,
    value: body.value,
  });

  logger.info({ tenantId, identifierId: identifier.id, schemeId: body.schemeId }, 'Identifier created');
  return NextResponse.json({ ok: true, identifier }, { status: 201 });
});

/**
 * @swagger
 * /identifiers:
 *   get:
 *     summary: List identifiers
 *     description: Retrieves a list of identifiers for the authenticated tenant with optional filtering
 *     tags:
 *       - Identifiers
 *     parameters:
 *       - in: query
 *         name: schemeId
 *         schema:
 *           type: string
 *         description: Filter by identifier scheme ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of identifiers to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of identifiers to skip for pagination
 *     responses:
 *       200:
 *         description: List of identifiers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 identifiers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Identifier'
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
  const schemeId = url.searchParams.get('schemeId') ?? undefined;
  const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, schemeId, limit, offset }, 'Listing identifiers');
  const identifiers = await listIdentifiers(tenantId, { schemeId, limit, offset });

  logger.info({ tenantId, count: identifiers.length }, 'Identifiers listed');
  return NextResponse.json({ ok: true, identifiers });
});
