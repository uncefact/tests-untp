import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { assertPublicUrl, ValidationError, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierById, createManyLinkRegistrations, listLinkRegistrations } from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';
import type { Link } from '@uncefact/untp-ri-services';

const logger = apiLogger.child({ route: '/api/v1/identifiers/[id]/links' });

/**
 * @swagger
 * /identifiers/{id}/links:
 *   post:
 *     summary: Publish links to the Identity Resolver
 *     description: Publishes one or more links for an identifier to the upstream IDR service
 *     tags:
 *       - Links
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The identifier ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - links
 *             properties:
 *               links:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - linkType
 *                     - targetUrl
 *                     - mimeType
 *                   properties:
 *                     linkType:
 *                       type: string
 *                     targetUrl:
 *                       type: string
 *                     mimeType:
 *                       type: string
 *                     title:
 *                       type: string
 *               qualifierPath:
 *                 type: string
 *                 description: Optional qualifier path for the IDR link
 *               description:
 *                 type: string
 *                 description: Description of the item being identified
 *     responses:
 *       201:
 *         description: Links published successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 resolverUri:
 *                   type: string
 *                   description: Canonical URI where this identifier can be resolved
 *                 identifierScheme:
 *                   type: string
 *                   description: The identifier scheme (e.g. "gtin", "abn")
 *                 identifier:
 *                   type: string
 *                   description: The identifier value
 *                 links:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       idrLinkId:
 *                         type: string
 *                         description: IDR-assigned link identifier
 *                       link:
 *                         type: object
 *                         description: The published link details
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Identifier not found
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
export const POST = withTenantAuth(async (req, { tenantId, params }) => {
  const { id: identifierId } = await params;

  logger.info({ identifierId }, 'Parsing request body');
  let body: {
    links?: Array<Record<string, unknown>>;
    qualifierPath?: string;
    description?: string;
  };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ identifierId }, 'Validating input parameters');
  if (!body.links || !Array.isArray(body.links) || body.links.length === 0) {
    throw new ValidationError('links is required and must be a non-empty array');
  }

  // Validate targetUrl in each link for SSRF protection
  for (const link of body.links) {
    if (typeof link.targetUrl === 'string') {
      await assertPublicUrl(link.targetUrl, 'links[].targetUrl');
    }
  }

  logger.info({ identifierId, linkCount: body.links.length }, 'Looking up identifier for link publishing');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const scheme = identifier.scheme;
  const registrar = scheme.registrar;
  const namespace = registrar.namespace;

  logger.info({ identifierId, primaryKey: scheme.primaryKey, namespace }, 'Resolving IDR service');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  logger.info({ identifierId, linkCount: body.links.length }, 'Publishing links to IDR service');
  const registration = await idrService.publishLinks(
    scheme.primaryKey,
    identifier.value,
    body.links as Link[],
    body.qualifierPath,
    { namespace, description: body.description },
  );

  logger.info({ identifierId, publishedCount: registration.links.length }, 'Storing audit records');
  const auditRecords = registration.links.map((l) => ({
    tenantId,
    identifierId,
    idrLinkId: l.idrLinkId,
    linkType: l.link.rel,
    targetUrl: l.link.href,
    mimeType: l.link.type,
    resolverUri: registration.resolverUri,
    qualifierPath: body.qualifierPath,
  }));
  await createManyLinkRegistrations(auditRecords);

  logger.info({ identifierId, linkCount: registration.links.length }, 'Links published');
  return NextResponse.json(registration, { status: 201 });
});

/**
 * @swagger
 * /identifiers/{id}/links:
 *   get:
 *     summary: List link registrations
 *     description: Retrieves link registrations for a specific identifier
 *     tags:
 *       - Links
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The identifier ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Maximum number of results to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of results to skip
 *     responses:
 *       200:
 *         description: Link registrations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LinkRegistration'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Identifier not found
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
export const GET = withTenantAuth(async (req, { tenantId, params }) => {
  const { id: identifierId } = await params;

  logger.info({ identifierId }, 'Looking up identifier for link listing');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const url = new URL(req.url);
  const rawLimit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
  const limit = rawLimit !== undefined ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

  const { data, total } = await listLinkRegistrations(identifierId, tenantId, limit, offset);
  logger.info({ identifierId, count: data.length }, 'Link registrations listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
