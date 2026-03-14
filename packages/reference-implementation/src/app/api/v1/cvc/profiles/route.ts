import { NextResponse } from 'next/server';
import { parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listProfiles } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/profiles' });

/**
 * @swagger
 * /cvc/profiles:
 *   get:
 *     summary: List conformity profiles
 *     description: Returns conformity profiles, optionally filtered by scheme.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: query
 *         name: schemeId
 *         schema:
 *           type: string
 *         description: Filter by parent scheme ID
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
 *         description: List of profiles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ConformityProfile'
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
  const schemeId = url.searchParams.get('schemeId') ?? undefined;
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ filters: { schemeId }, limit, offset }, 'Querying profiles from database');
  const { data, total } = await listProfiles(tenantId, { schemeId, limit, offset });

  logger.info({ count: data.length, total }, 'Profiles retrieved');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
