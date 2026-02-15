import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierById, createManyLinkRegistrations, listLinkRegistrations } from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { apiLogger } from '@/lib/api/logger';
import type { Link } from '@uncefact/untp-ri-services';

const logger = apiLogger.child({ route: '/api/v1/identifiers/[id]/links' });

/**
 * @swagger
 * /identifiers/{id}/links:
 *   post:
 *     tags: [Links]
 *     summary: Publish links to an IDR service
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [links]
 *             properties:
 *               links:
 *                 type: array
 *                 items:
 *                   type: object
 *               qualifierPath:
 *                 type: string
 *               itemDescription:
 *                 type: string
 *     responses:
 *       201:
 *         description: Links published successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Identifier not found
 *       500:
 *         description: IDR service error
 */
export const POST = withTenantAuth(async (req, { tenantId, params }) => {
  const { id: identifierId } = await params;

  let body: {
    links?: Array<Record<string, unknown>>;
    qualifierPath?: string;
    itemDescription?: string;
  };
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (!body.links || !Array.isArray(body.links) || body.links.length === 0) {
    throw new ValidationError('links is required and must be a non-empty array');
  }

  logger.info({ tenantId, identifierId, linkCount: body.links.length }, 'Looking up identifier for link publishing');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const scheme = identifier.scheme;
  const registrar = scheme.registrar;
  const namespace = scheme.namespace ?? registrar.namespace;

  logger.info({ tenantId, identifierId, primaryKey: scheme.primaryKey, namespace }, 'Resolving IDR service');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  logger.info({ tenantId, identifierId, linkCount: body.links.length }, 'Publishing links to IDR service');
  const registration = await idrService.publishLinks(
    scheme.primaryKey,
    identifier.value,
    body.links as Link[],
    body.qualifierPath,
    { namespace, itemDescription: body.itemDescription },
  );

  logger.info({ tenantId, identifierId, publishedCount: registration.links.length }, 'Storing audit records');
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

  logger.info({ tenantId, identifierId, linkCount: registration.links.length }, 'Links published');
  return NextResponse.json({ ok: true, registration }, { status: 201 });
});

/**
 * @swagger
 * /identifiers/{id}/links:
 *   get:
 *     tags: [Links]
 *     summary: List link registrations for an identifier
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of link registrations
 *       404:
 *         description: Identifier not found
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id: identifierId } = await params;

  logger.info({ tenantId, identifierId }, 'Looking up identifier for link listing');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const linkRegistrations = await listLinkRegistrations(identifierId, tenantId);
  logger.info({ tenantId, identifierId, count: linkRegistrations.length }, 'Link registrations listed');
  return NextResponse.json({ ok: true, linkRegistrations });
});
