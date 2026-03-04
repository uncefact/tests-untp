import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getSchemeById } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/schemes/[id]' });

/**
 * @swagger
 * /cvc/schemes/{id}:
 *   get:
 *     summary: Get a conformity scheme by ID
 *     description: Returns the scheme with its profiles.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the scheme
 *     responses:
 *       200:
 *         description: Scheme details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConformityScheme'
 *       401:
 *         description: Unauthorised
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
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ schemeId: id }, 'Looking up conformity scheme');
  const scheme = await getSchemeById(id, tenantId);
  if (!scheme) {
    throw new NotFoundError('Scheme not found');
  }

  logger.info({ schemeId: id }, 'Scheme retrieved');
  return NextResponse.json(scheme);
});
