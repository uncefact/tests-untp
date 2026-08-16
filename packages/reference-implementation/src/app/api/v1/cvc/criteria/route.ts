import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { listConformityCriteria } from '@/lib/prisma/repositories';
import { paginateInMemory } from '@/lib/api/pagination';
import { parseQueryParams } from '@/lib/api/validation';
import { listCvcCriteriaQuerySchema } from '@/lib/api/request-schemas/cvc';

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
 *           minLength: 1
 *         description: Canonical URI of the profile whose criteria to list. A whitespace-only value is rejected with a 400.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Number of entries to return per page. Defaults to 20, or the configured maximum when it is lower. A larger value is rejected with a 400 naming the maximum.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of entries to skip for pagination
 *     responses:
 *       200:
 *         description: A page of conformity criteria
 *       400:
 *         description: Validation error (e.g. a missing or blank profileId, a limit above the maximum, a repeated query parameter)
 *       401:
 *         description: Unauthorised
 *       403:
 *         description: No tenant found for user
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const { profileId, limit, offset } = parseQueryParams(new URL(req.url), listCvcCriteriaQuerySchema);

  logger.info({ tenantId, profileId }, 'Listing conformity criteria');
  const criteria = await listConformityCriteria(profileId, tenantId);

  return NextResponse.json(paginateInMemory(criteria, limit, offset));
});
