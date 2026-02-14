import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDidById, updateDid } from '@/lib/prisma/repositories';

/**
 * @swagger
 * /dids/{id}:
 *   get:
 *     summary: Get a DID by ID
 *     description: Retrieves a specific DID by its database ID
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the DID
 *     responses:
 *       200:
 *         description: DID retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 did:
 *                   $ref: '#/components/schemas/Did'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: DID not found
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
  const did = await getDidById(id, tenantId);
  if (!did) {
    throw new NotFoundError('DID not found');
  }
  return NextResponse.json({ ok: true, did });
});

/**
 * @swagger
 * /dids/{id}:
 *   put:
 *     summary: Update a DID
 *     description: Updates the name and/or description of a specific DID
 *     tags:
 *       - DIDs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the DID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name for the DID
 *               description:
 *                 type: string
 *                 description: New description for the DID
 *             minProperties: 1
 *     responses:
 *       200:
 *         description: DID updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 did:
 *                   $ref: '#/components/schemas/Did'
 *       400:
 *         description: Validation error - at least one field required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: DID not found
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
export const PUT = withTenantAuth(async (req, { tenantId, params }) => {
  const { id } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const hasName = isNonEmptyString(body.name);
  const hasDescription = isNonEmptyString(body.description);

  if (!hasName && !hasDescription) {
    throw new ValidationError('At least one of name or description is required');
  }

  const updated = await updateDid(id, tenantId, {
    ...(hasName && { name: body.name }),
    ...(hasDescription && { description: body.description }),
  });
  return NextResponse.json({ ok: true, did: updated });
});
