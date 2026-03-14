import { NextResponse } from 'next/server';
import { parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listCriteria } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/criteria' });

/**
 * @swagger
 * /cvc/criteria:
 *   get:
 *     summary: List criteria
 *     description: Returns criteria, optionally filtered by profile.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: query
 *         name: profileId
 *         schema:
 *           type: string
 *         description: Filter by parent profile ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of results to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of results to skip
 *     responses:
 *       200:
 *         description: List of criteria
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Criterion'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);

  logger.info('Parsing and validating query filters');
  const profileId = url.searchParams.get('profileId') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ filters: { profileId }, limit, offset }, 'Querying criteria from database');
  const { data, total } = await listCriteria(tenantId, { profileId, limit, offset });

  logger.info({ count: data.length, total }, 'Criteria retrieved');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
