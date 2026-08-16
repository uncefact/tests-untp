import { NextResponse } from 'next/server';
import { z } from 'zod';
import { NotFoundError } from '@/lib/api/errors';
import { assertPublicUrl, ValidationError, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierById, createManyLinkRegistrations, listLinkRegistrations } from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { buildPaginatedResponse, MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';
import type { Link } from '@uncefact/untp-ri-services';
import { linkSchema } from '@/lib/api/request-schemas/link';

const publishLinksRequestSchema = z.object({
  links: z.array(linkSchema).min(1),
  qualifierPath: z.string().optional(),
  description: z.string().optional(),
});

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
 *                     - href
 *                     - rel
 *                     - type
 *                   properties:
 *                     href:
 *                       type: string
 *                       format: uri
 *                       description: Target URL of the linked resource
 *                     rel:
 *                       type: string
 *                       description: Primary RFC 9264 link relation type (e.g. untp:dpp)
 *                     type:
 *                       type: string
 *                       description: IANA media type of the target resource
 *                     title:
 *                       type: string
 *                     hreflang:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: BCP 47 language tags the variant serves
 *                     context:
 *                       type: string
 *                       description: Regional context for the variant (e.g. au)
 *                     default:
 *                       type: boolean
 *                       description: Whether this is the default variant for its relation type
 *                     accessRole:
 *                       type: array
 *                       items:
 *                         type: string
 *                         enum:
 *                           - untp:accessRole#Anonymous
 *                           - untp:accessRole#Customer
 *                           - untp:accessRole#Regulator
 *                           - untp:accessRole#Recycler
 *                           - untp:accessRole#Auditor
 *                           - untp:accessRole#Owner
 *                       description: UNTP access roles that may retrieve this link variant
 *                     additionalRels:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Additional link relation types qualifying the link beyond its primary rel
 *                     public:
 *                       type: boolean
 *                       description: Whether the target URL itself is safe to publish in a public directory
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
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
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
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ identifierId }, 'Validating input parameters');
  const parsed = publishLinksRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(`${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  const body = parsed.data;

  // SSRF guard on each link's target URL.
  for (const link of body.links) {
    await assertPublicUrl(link.href, 'links[].href');
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
    { namespace, ...(body.description !== undefined ? { description: body.description } : {}) },
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
 *         $ref: '#/components/responses/UnauthorisedResponse'
 *       403:
 *         $ref: '#/components/responses/TenantAssignmentForbiddenResponse'
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
