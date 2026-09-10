import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { retiredRoute } from '@/lib/api/retired-route';

/**
 * @swagger
 * /credentials/{id}:
 *   get:
 *     operationId: getCredentialRetired
 *     summary: 'RETIRED: use GET /api/v1/library/{id}'
 *     deprecated: true
 *     description: |
 *       Retired with no deprecation window. Authentication and tenant
 *       resolution run before retirement. The supplied id is not looked up.
 *       Use GET /api/v1/library/{id} with the same credential record id.
 *       See the migration guide at `/docs/migration-guides/ri-v0.5`.
 *     tags:
 *       - Credentials
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Credential record id. The retired route does not look it up.
 *     responses:
 *       401:
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
 *       410:
 *         description: |
 *           This route has been retired. Use GET /api/v1/library/{id} instead.
 *           Returned after authentication and tenant resolution succeed.
 *         headers:
 *           Cache-Control:
 *             description: Prevents caching of the retirement response.
 *             schema:
 *               type: string
 *               enum: [no-store]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               retired:
 *                 value:
 *                   error: This route has been retired. Use GET /api/v1/library/{id} instead.
 *                   code: ROUTE_RETIRED
 *       500:
 *         description: 'The request could not be completed and the response body is sanitised.'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async () => retiredRoute('GET /api/v1/library/{id}'));
