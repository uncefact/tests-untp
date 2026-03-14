import { NextResponse } from 'next/server';
import { ValidationError, isNonEmptyString, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { listCatalogues } from '@/lib/prisma/repositories';
import { importCvc } from '@/lib/services/cvc-import.service';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/cvc/catalogues' });

/**
 * @swagger
 * /cvc/catalogues:
 *   get:
 *     summary: List CVC catalogues
 *     description: Returns all imported CVC catalogues visible to the tenant, including system-provisioned catalogues.
 *     tags:
 *       - CVC
 *     parameters:
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
 *         description: List of catalogues
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CvcCatalogue'
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

  logger.info('Parsing pagination parameters');
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  logger.info({ limit, offset }, 'Querying catalogues from database');
  const { data, total } = await listCatalogues(tenantId, { limit, offset });

  logger.info({ count: data.length, total }, 'Catalogues retrieved');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});

/**
 * @swagger
 * /cvc/catalogues:
 *   post:
 *     summary: Import a CVC catalogue
 *     description: |
 *       Fetches a Conformity Vocabulary Catalogue from the given URL (JSON-LD),
 *       parses its hierarchy (schemes, profiles, criteria), and persists it.
 *       Re-importing the same catalogue replaces the previous version.
 *     tags:
 *       - CVC
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CvcImportRequest'
 *     responses:
 *       201:
 *         description: Catalogue imported
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 catalogue:
 *                   $ref: '#/components/schemas/CvcCatalogue'
 *                 summary:
 *                   $ref: '#/components/schemas/CvcImportSummary'
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const POST = withTenantAuth(async (req, { tenantId }) => {
  let body: { url?: string; version?: string };

  logger.info('Parsing request body');
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info('Validating import parameters');
  if (!isNonEmptyString(body.url)) {
    throw new ValidationError('url is required');
  }
  if (!isNonEmptyString(body.version)) {
    throw new ValidationError('version is required');
  }

  try {
    const parsed = new URL(body.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('url must use http or https protocol');
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('url must be a valid URL');
  }

  logger.info({ url: body.url, version: body.version }, 'Importing CVC catalogue from URL');
  const { catalogue, summary } = await importCvc(tenantId, body.url, body.version);

  logger.info({ catalogueId: catalogue.id, summary }, 'CVC catalogue imported');
  return NextResponse.json({ catalogue, summary }, { status: 201 });
});
