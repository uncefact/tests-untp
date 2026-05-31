import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { listConformityProfiles } from '@/lib/prisma/repositories';
import { paginateInMemory, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';

const logger = apiLogger.child({ route: '/api/v1/cvc/profiles' });

/**
 * @swagger
 * /cvc/profiles:
 *   get:
 *     summary: List the profiles a conformity scheme publishes
 *     description: |
 *       Returns the versioned profiles for the scheme identified by `schemeId`
 *       (its canonical URI), resolved against the catalogue with the same
 *       system-tenant precedence as scheme lookup. Each entry's `id` is the
 *       stable canonical profile URI to reference in a conformityClaim. An
 *       unknown scheme returns an empty list.
 *     tags:
 *       - Conformity Vocabulary
 *     parameters:
 *       - in: query
 *         name: schemeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Canonical URI of the scheme whose profiles to list
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A page of conformity profiles
 *       400:
 *         description: schemeId is missing, or a pagination parameter is invalid
 *       401:
 *         description: Unauthorised
 *       403:
 *         description: No tenant found for user
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);
  const schemeId = url.searchParams.get('schemeId');
  if (!isNonEmptyString(schemeId)) {
    throw new ValidationError('schemeId is required');
  }

  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, schemeId }, 'Listing conformity profiles');
  const profiles = await listConformityProfiles(schemeId, tenantId);

  return NextResponse.json(paginateInMemory(profiles, limit, offset));
});
