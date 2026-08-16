import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { assertHttpUrl, assertPublicUrl, parseQueryParams, parseRequestBody } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierById, createManyLinkRegistrations, listLinkRegistrations } from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { buildPaginatedResponse } from '@/lib/api/pagination';
import { apiLogger } from '@/lib/api/logger';
import type { Link } from '@uncefact/untp-ri-services';
import { listLinksQuerySchema, publishLinksRequestSchema } from '@/lib/api/request-schemas/link';

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
 *                       description: Primary RFC 9264 link relation type (e.g. untp:dpp). Must carry non-whitespace content.
 *                     type:
 *                       type: string
 *                       description: IANA media type of the target resource. Must carry non-whitespace content.
 *                     title:
 *                       type: string
 *                     hreflang:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: BCP 47 (RFC 5646) language tags the variant serves, e.g. "en", "en-AU", "x-default". An entry that is not a well-formed tag is rejected with a 400.
 *                     context:
 *                       type: string
 *                       description: Regional context for the variant (e.g. au). The current Identity Resolver adapter does not publish this field.
 *                     default:
 *                       type: boolean
 *                       description: Whether this is the default variant for its relation type. The current Identity Resolver adapter does not publish this field.
 *                     method:
 *                       type: string
 *                       enum:
 *                         - GET
 *                         - POST
 *                       description: HTTP method used to retrieve the link target. The current Identity Resolver adapter does not publish this field.
 *                     encryptionMethod:
 *                       type: string
 *                       description: Encryption method identifier for the target resource. The current Identity Resolver adapter does not publish this field.
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
 *                       description: Additional link relation types qualifying the link beyond its primary rel. Each entry must carry non-whitespace content.
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

  logger.info({ identifierId }, 'Parsing and validating request body');
  const body = await parseRequestBody(req, publishLinksRequestSchema);

  // Each link's target URL is validated as a well-formed, absolute,
  // userinfo-free http(s) URL, and the WHATWG-canonical href replaces the
  // caller's raw string before anything downstream sees it. Validating and
  // publishing the same canonical form closes a parser-differential SSRF gap:
  // a value like `https://1.1.1.1\@127.0.0.1/` that this parser reads as host
  // `1.1.1.1` cannot be re-read as `127.0.0.1` by the IDR's parser once the
  // canonical href is what leaves the route. This follows credentials/route.ts,
  // which canonicalises for the same reason; registrars/route.ts deliberately
  // stores its URL verbatim instead, because nothing dereferences that value
  // server-side (see the comment there). The private-address check is gated on
  // VERIFY_ALLOW_PRIVATE_URLS as it is on every sibling route, so local
  // development can publish links to a private IDR target.
  const links = body.links.map((link, index) => ({
    ...link,
    href: assertHttpUrl(link.href, `links.${index}.href`).href,
  }));
  if (process.env.VERIFY_ALLOW_PRIVATE_URLS !== 'true') {
    for (const [index, link] of links.entries()) {
      await assertPublicUrl(link.href, `links.${index}.href`);
    }
  }

  logger.info({ identifierId, linkCount: links.length }, 'Looking up identifier for link publishing');
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

  logger.info({ identifierId, linkCount: links.length }, 'Publishing links to IDR service');
  const registration = await idrService.publishLinks(
    scheme.primaryKey,
    identifier.value,
    links as Link[],
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
 *         description: Number of link registrations to return per page. Defaults to 20, or the configured maximum when it is lower. A larger value is rejected with a 400 naming the maximum.
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

  // Before the identifier lookup, so a caller who sends both a bad limit and
  // an identifier that does not exist is told about the parameter they can
  // fix. POST and PATCH validate ahead of their lookups for the same reason.
  const { limit, offset } = parseQueryParams(new URL(req.url), listLinksQuerySchema);

  logger.info({ identifierId }, 'Looking up identifier for link listing');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const { data, total } = await listLinkRegistrations(identifierId, tenantId, limit, offset);
  logger.info({ identifierId, count: data.length }, 'Link registrations listed');
  return NextResponse.json(buildPaginatedResponse(data, total, limit, offset));
});
