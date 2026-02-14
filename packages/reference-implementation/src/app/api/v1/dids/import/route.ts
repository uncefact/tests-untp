import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/api/errors';
import { ValidationError, isNonEmptyString, validateEnum } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { createDid } from '@/lib/prisma/repositories';
import { DidMethod } from '@uncefact/untp-ri-services';

/**
 * @swagger
 * /dids/import:
 *   post:
 *     tags: [DIDs]
 *     summary: Import an externally managed DID
 *     description: Registers an existing DID locally without calling the adapter create method. Sets status to UNVERIFIED for subsequent verification.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - did
 *               - method
 *               - keyId
 *             properties:
 *               did:
 *                 type: string
 *                 description: The DID identifier to import (e.g., did:web:example.com)
 *               method:
 *                 type: string
 *                 enum: [DID_WEB, DID_WEB_VH]
 *                 description: DID method
 *               keyId:
 *                 type: string
 *                 description: Key identifier associated with the DID
 *               name:
 *                 type: string
 *                 description: Human-readable name for the DID
 *               description:
 *                 type: string
 *                 description: Description of the DID's purpose
 *               serviceInstanceId:
 *                 type: string
 *                 description: Optional service instance ID for verification
 *     responses:
 *       201:
 *         description: DID imported successfully
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
 *         description: Validation error
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
    did?: string;
    method?: string;
    keyId?: string;
    name?: string;
    description?: string;
    serviceInstanceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if (!isNonEmptyString(body.did)) {
      throw new ValidationError('did is required');
    }
    if (!isNonEmptyString(body.keyId)) {
      throw new ValidationError('keyId is required');
    }

    const method = validateEnum(body.method, Object.values(DidMethod), 'method');
    if (!method) {
      throw new ValidationError('method is required');
    }

    // Import: register locally without calling adapter create
    const record = await createDid({
      tenantId,
      did: body.did,
      type: 'SELF_MANAGED',
      method,
      keyId: body.keyId,
      name: body.name ?? body.did,
      description: body.description,
      status: 'UNVERIFIED',
      serviceInstanceId: body.serviceInstanceId,
    });

    return NextResponse.json({ ok: true, did: record }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
