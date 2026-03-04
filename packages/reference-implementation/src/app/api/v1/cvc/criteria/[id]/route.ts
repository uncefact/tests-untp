import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getCriterionById } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/criteria/[id]' });

/**
 * @swagger
 * /cvc/criteria/{id}:
 *   get:
 *     summary: Get a criterion by ID
 *     description: Returns the criterion with its profile memberships.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the criterion
 *     responses:
 *       200:
 *         description: Criterion details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Criterion'
 *       401:
 *         description: Unauthorised
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Criterion not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ criterionId: id }, 'Looking up criterion');
  const criterion = await getCriterionById(id, tenantId);
  if (!criterion) {
    throw new NotFoundError('Criterion not found');
  }

  logger.info({ criterionId: id }, 'Criterion retrieved');
  return NextResponse.json(criterion);
});
