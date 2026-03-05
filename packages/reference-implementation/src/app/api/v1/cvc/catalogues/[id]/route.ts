import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getCatalogueById, deleteCatalogue } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/catalogues/[id]' });

/**
 * @swagger
 * /cvc/catalogues/{id}:
 *   get:
 *     summary: Get a CVC catalogue by ID
 *     description: Returns the catalogue with its scheme count summary.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the catalogue
 *     responses:
 *       200:
 *         description: Catalogue details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CvcCatalogue'
 *       401:
 *         description: Unauthorised
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Catalogue not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ catalogueId: id }, 'Looking up catalogue');
  const catalogue = await getCatalogueById(id, tenantId);
  if (!catalogue) {
    throw new NotFoundError('Catalogue not found');
  }

  logger.info({ catalogueId: id }, 'Catalogue retrieved');
  return NextResponse.json(catalogue);
});

/**
 * @swagger
 * /cvc/catalogues/{id}:
 *   delete:
 *     summary: Delete a CVC catalogue
 *     description: Cascade-deletes the catalogue and all its schemes, profiles, and profile-criterion links. Orphan criteria are cleaned up.
 *     tags:
 *       - CVC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the catalogue
 *     responses:
 *       204:
 *         description: Catalogue deleted
 *       401:
 *         description: Unauthorised
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Catalogue not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ catalogueId: id }, 'Deleting catalogue');
  await deleteCatalogue(id, tenantId);

  logger.info({ catalogueId: id }, 'Catalogue deleted');
  return new NextResponse(null, { status: 204 });
});
