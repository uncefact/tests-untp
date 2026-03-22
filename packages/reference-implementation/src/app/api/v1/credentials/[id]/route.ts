import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getCredentialById } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/credentials/[id]' });

/**
 * @swagger
 * /credentials/{id}:
 *   get:
 *     summary: Get a credential by ID
 *     description: Retrieves a specific credential record by its database ID
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the credential
 *     responses:
 *       200:
 *         description: Credential retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Credential'
 *       401:
 *         description: Unauthorised — missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Credential not found
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
  logger.info({ credentialId: id }, 'Looking up credential');

  const credential = await getCredentialById(id, tenantId);
  if (!credential) {
    throw new NotFoundError('Credential not found');
  }

  logger.info({ credentialId: credential.id }, 'Credential retrieved');

  return NextResponse.json(credential);
});
