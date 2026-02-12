import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage } from '@/lib/api/errors';
import { isNonEmptyString } from '@/lib/api/validation';
import { withOrgAuth } from '@/lib/api/with-org-auth';
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
export const GET = withOrgAuth(async (_req, { organizationId, params }) => {
  const { id } = await params;

  try {
    const did = await getDidById(id, organizationId);
    if (!did) {
      throw new NotFoundError('DID not found');
    }
    return NextResponse.json({ ok: true, did });
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
export const PUT = withOrgAuth(async (req, { organizationId, params }) => {
  const { id } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const hasName = isNonEmptyString(body.name);
  const hasDescription = isNonEmptyString(body.description);

  if (!hasName && !hasDescription) {
    return NextResponse.json({ ok: false, error: 'At least one of name or description is required' }, { status: 400 });
  }

  try {
    const updated = await updateDid(id, organizationId, {
      ...(hasName && { name: body.name }),
      ...(hasDescription && { description: body.description }),
    });
    return NextResponse.json({ ok: true, did: updated });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
