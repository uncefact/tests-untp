import { NextResponse } from 'next/server';
import { parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listSchemes } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/schemes' });

/**
 * @swagger
 * /cvc/schemes:
 *   get:
 *     summary: List conformity schemes
 *     description: Returns conformity schemes, optionally filtered by catalogue. Includes profile counts.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: query
 *         name: catalogueId
 *         schema:
 *           type: string
 *         description: Filter by parent catalogue ID
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
 *         description: List of schemes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ConformityScheme'
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
  const catalogueId = url.searchParams.get('catalogueId') ?? undefined;
  const parsedLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const parsedOffset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ filters: { catalogueId }, limit: parsedLimit, offset: parsedOffset }, 'Querying schemes from database');
  const { data, total } = await listSchemes(tenantId, { catalogueId, limit: parsedLimit, offset: parsedOffset });

  const limit = parsedLimit ?? DEFAULT_PAGE_LIMIT;
  const offset = parsedOffset ?? 0;

  logger.info({ count: data.length, total }, 'Schemes retrieved');
  return NextResponse.json({
    data,
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  });
});
