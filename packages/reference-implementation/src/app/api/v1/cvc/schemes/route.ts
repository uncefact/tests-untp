import { NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { apiLogger } from '@/lib/api/logger';
import { listConformitySchemes } from '@/lib/prisma/repositories';
import { paginateInMemory } from '@/lib/api/pagination';
import { parseQueryParams } from '@/lib/api/validation';
import { listCvcSchemesQuerySchema } from '@/lib/api/request-schemas/cvc';

const logger = apiLogger.child({ route: '/api/v1/cvc/schemes' });

/**
 * @swagger
 * /cvc/schemes:
 *   get:
 *     summary: List the conformity schemes registered in this reference implementation
 *     description: |
 *       Returns the conformity schemes registered in this reference
 *       implementation and visible to the authenticated tenant: the system
 *       catalogue (UNTP-discovered and operator-seeded) plus the tenant's own
 *       imports. This is the reference implementation's own catalogue, not the
 *       UNTP register it draws from, so a scheme published elsewhere appears
 *       here only once it has been registered. A system-tenant entry supersedes
 *       a tenant import of the same URI. Each entry's `id` is the stable
 *       canonical scheme URI to reference in a conformityClaim.
 *     tags:
 *       - Conformity Vocabulary Catalogue
 *     parameters:
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
 *         description: A page of conformity schemes
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
 *         description: Validation error (e.g. an invalid or above-maximum limit or offset, a repeated query parameter)
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
 *       403:
 *         description: No tenant found for user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (req, { tenantId }) => {
  const { limit, offset } = parseQueryParams(new URL(req.url), listCvcSchemesQuerySchema);

  logger.info({ tenantId }, 'Listing conformity schemes');
  const schemes = await listConformitySchemes(tenantId);

  return NextResponse.json(paginateInMemory(schemes, limit, offset));
});
