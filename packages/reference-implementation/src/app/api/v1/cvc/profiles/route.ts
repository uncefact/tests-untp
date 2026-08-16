import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { listConformityProfiles } from '@/lib/prisma/repositories';
import { paginateInMemory } from '@/lib/api/pagination';
import { parseQueryParams } from '@/lib/api/validation';
import { listCvcProfilesQuerySchema } from '@/lib/api/request-schemas/cvc';

const logger = apiLogger.child({ route: '/api/v1/cvc/profiles' });

/**
 * @swagger
 * /cvc/profiles:
 *   get:
 *     summary: List the profiles a registered conformity scheme publishes
 *     description: |
 *       Returns the versioned profiles for the scheme identified by `schemeId`
 *       (its canonical URI), resolved against the schemes registered in this
 *       reference implementation with the same system-tenant precedence as
 *       scheme lookup. Each entry's `id` is the stable canonical profile URI to
 *       reference in a conformityClaim. A scheme that is not registered here
 *       returns an empty list.
 *     tags:
 *       - Conformity Vocabulary Catalogue
 *     parameters:
 *       - in: query
 *         name: schemeId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *         description: Canonical URI of the scheme whose profiles to list. A whitespace-only value is rejected with a 400.
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
 *         description: A page of conformity profiles
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
 *         description: Validation error (e.g. a missing or blank schemeId, a limit above the maximum, a repeated query parameter)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const { schemeId, limit, offset } = parseQueryParams(new URL(req.url), listCvcProfilesQuerySchema);

  logger.info({ tenantId, schemeId }, 'Listing conformity profiles');
  const profiles = await listConformityProfiles(schemeId, tenantId);

  return NextResponse.json(paginateInMemory(profiles, limit, offset));
});
