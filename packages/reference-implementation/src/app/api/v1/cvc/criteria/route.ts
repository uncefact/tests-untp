import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { listConformityCriteria } from '@/lib/prisma/repositories';
import { paginateInMemory, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';

const logger = apiLogger.child({ route: '/api/v1/cvc/criteria' });

/**
 * @swagger
 * /cvc/criteria:
 *   get:
 *     summary: List the criteria a conformity profile references
 *     description: |
 *       Returns the versioned criteria for the profile identified by `profileId`
 *       (its canonical URI), resolved against the catalogue with system-tenant
 *       precedence. Each entry's `id` is the stable canonical criterion URI to
 *       reference in a conformityClaim, alongside the conformity topics that
 *       criterion defines. An unknown profile returns an empty list.
 *     tags:
 *       - Conformity Vocabulary
 *     parameters:
 *       - in: query
 *         name: profileId
 *         required: true
 *         schema:
 *           type: string
 *         description: Canonical URI of the profile whose criteria to list
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
 *         description: A page of conformity criteria
 *       400:
 *         description: profileId is missing, or a pagination parameter is invalid
 *       401:
 *         description: Unauthorised
 *       403:
 *         description: No tenant found for user
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');
  if (!isNonEmptyString(profileId)) {
    throw new ValidationError('profileId is required');
  }

  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ tenantId, profileId }, 'Listing conformity criteria');
  const criteria = await listConformityCriteria(profileId, tenantId);

  return NextResponse.json(paginateInMemory(criteria, limit, offset));
});
