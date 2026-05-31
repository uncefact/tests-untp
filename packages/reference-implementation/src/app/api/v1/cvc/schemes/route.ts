import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { listConformitySchemes } from '@/lib/prisma/repositories';
import { paginateInMemory, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';

const logger = apiLogger.child({ route: '/api/v1/cvc/schemes' });

/**
 * @swagger
 * /cvc/schemes:
 *   get:
 *     summary: List registered conformity schemes
 *     description: |
 *       Returns the conformity schemes visible to the authenticated tenant: the
 *       system catalogue (UNTP and operator-seeded) plus the tenant's own
 *       imports. A system-tenant entry supersedes a tenant import of the same
 *       URI. Each entry's `id` is the stable canonical scheme URI to reference
 *       in a conformityClaim.
 *     tags:
 *       - Conformity Vocabulary
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum entries per page (capped at the server maximum)
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of entries to skip
 *     responses:
 *       200:
 *         description: A page of conformity schemes
 *       400:
 *         description: Invalid pagination parameter (limit or offset)
 *       401:
 *         description: Unauthorised
 *       403:
 *         description: No tenant found for user
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId }, 'Listing conformity schemes');
  const schemes = await listConformitySchemes(tenantId);

  return NextResponse.json(paginateInMemory(schemes, limit, offset));
});
