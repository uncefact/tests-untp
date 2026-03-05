import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getProfileById } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/profiles/[id]' });

/**
 * @swagger
 * /cvc/profiles/{id}:
 *   get:
 *     summary: Get a conformity profile by ID
 *     description: Returns the profile with its criteria.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the profile
 *     responses:
 *       200:
 *         description: Profile details with criteria
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConformityProfile'
 *       401:
 *         description: Unauthorised
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ profileId: id }, 'Looking up conformity profile');
  const profile = await getProfileById(id, tenantId);
  if (!profile) {
    throw new NotFoundError('Profile not found');
  }

  logger.info({ profileId: id }, 'Profile retrieved');
  return NextResponse.json(profile);
});
