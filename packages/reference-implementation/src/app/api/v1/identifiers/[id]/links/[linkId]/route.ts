import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { assertPublicUrl, parseRequestBody } from '@/lib/api/validation';
import { updateLinkRequestSchema } from '@/lib/api/request-schemas/link';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import {
  getIdentifierById,
  getLinkRegistrationByIdrLinkId,
  updateLinkRegistration,
  deleteLinkRegistration,
} from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { IdrLinkNotFoundError } from '@uncefact/untp-ri-services';
import type { Link } from '@uncefact/untp-ri-services';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/identifiers/[id]/links/[linkId]' });

/**
 * @swagger
 * /identifiers/{id}/links/{linkId}:
 *   get:
 *     summary: Get a link by IDR link ID
 *     description: Retrieves a link from the upstream IDR along with the local audit record. Returns a desync flag if the link exists locally but is missing upstream.
 *     tags:
 *       - Links
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The identifier ID
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: The IDR link ID
 *     responses:
 *       200:
 *         description: Link details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 link:
 *                   type: object
 *                   nullable: true
 *                 localRecord:
 *                   $ref: '#/components/schemas/LinkRegistration'
 *                 desync:
 *                   type: boolean
 *                 warning:
 *                   type: string
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Link not found
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
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id: identifierId, linkId } = await params;

  logger.info({ identifierId, linkId }, 'Looking up identifier and local link record');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const localRecord = await getLinkRegistrationByIdrLinkId(linkId, identifierId, tenantId);
  if (!localRecord) {
    throw new NotFoundError('Link registration not found');
  }

  const scheme = identifier.scheme;
  const registrar = scheme.registrar;

  logger.info({ identifierId, linkId }, 'Resolving IDR service for link retrieval');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  try {
    logger.info({ identifierId, linkId }, 'Fetching live link data from IDR');
    const link = await idrService.getLinkById(linkId);
    return NextResponse.json({ link, localRecord });
  } catch (idrError: unknown) {
    if (idrError instanceof IdrLinkNotFoundError) {
      logger.warn({ identifierId, linkId }, 'Link desync — exists locally but missing from upstream IDR');
      return NextResponse.json(
        {
          link: null,
          localRecord,
          desync: true,
          warning: `Link "${linkId}" exists locally but is no longer present on the upstream IDR. It may have been removed out-of-band.`,
        },
        { status: 200 },
      );
    }
    throw idrError;
  }
});

/**
 * @swagger
 * /identifiers/{id}/links/{linkId}:
 *   patch:
 *     summary: Update a link
 *     description: Updates a link on the upstream IDR and syncs the local audit record
 *     tags:
 *       - Links
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The identifier ID
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: The IDR link ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               href:
 *                 type: string
 *                 format: uri
 *               rel:
 *                 type: string
 *               type:
 *                 type: string
 *               title:
 *                 type: string
 *               hreflang:
 *                 type: array
 *                 items:
 *                   type: string
 *               additionalRels:
 *                 type: array
 *                 items:
 *                   type: string
 *               public:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Link updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 href:
 *                   type: string
 *                 rel:
 *                   type: string
 *                 type:
 *                   type: string
 *                 title:
 *                   type: string
 *                 hreflang:
 *                   type: array
 *                   items:
 *                     type: string
 *                 additionalRels:
 *                   type: array
 *                   items:
 *                     type: string
 *                 public:
 *                   type: boolean
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
 *         description: Link not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Desynchronisation — link no longer exists on the upstream IDR
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 desync:
 *                   type: boolean
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id: identifierId, linkId } = await params;

  logger.info({ identifierId, linkId }, 'Parsing and validating request body');
  const body = await parseRequestBody(req, updateLinkRequestSchema);

  if (body.href !== undefined) await assertPublicUrl(body.href, 'href');

  logger.info({ identifierId, linkId }, 'Looking up identifier and local link record for update');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const localRecord = await getLinkRegistrationByIdrLinkId(linkId, identifierId, tenantId);
  if (!localRecord) {
    throw new NotFoundError('Link registration not found');
  }

  const scheme = identifier.scheme;
  const registrar = scheme.registrar;

  logger.info({ identifierId, linkId }, 'Resolving IDR service for link update');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  try {
    logger.info({ identifierId, linkId }, 'Updating link on upstream IDR');
    const updatedLink = await idrService.updateLink(linkId, body as Partial<Link>);

    logger.info({ identifierId, linkId }, 'Syncing local record with upstream state');
    await updateLinkRegistration(linkId, identifierId, tenantId, {
      linkType: updatedLink.rel,
      targetUrl: updatedLink.href,
      mimeType: updatedLink.type,
    });

    logger.info({ identifierId, linkId }, 'Link updated');
    return NextResponse.json(updatedLink);
  } catch (e: unknown) {
    if (e instanceof IdrLinkNotFoundError) {
      logger.warn({ identifierId, linkId }, 'Link desync — cannot update, missing from upstream IDR');
      return NextResponse.json(
        {
          error: `Link "${linkId}" no longer exists on the upstream IDR. It may have been removed out-of-band. Delete the local record to resolve this desynchronisation.`,
          desync: true,
        },
        { status: 409 },
      );
    }
    throw e;
  }
});

/**
 * @swagger
 * /identifiers/{id}/links/{linkId}:
 *   delete:
 *     summary: Delete a link
 *     description: >
 *       Deletes a link from both the upstream IDR and the local record.
 *       If the link has already been removed from the upstream IDR (out-of-band),
 *       the local record is still cleaned up.
 *     tags:
 *       - Links
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The identifier ID
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: The IDR link ID
 *     responses:
 *       204:
 *         description: Link deleted successfully
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Link not found
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
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id: identifierId, linkId } = await params;

  logger.info({ identifierId, linkId }, 'Looking up identifier and local link record for deletion');
  const identifier = await getIdentifierById(identifierId, tenantId);
  if (!identifier) {
    throw new NotFoundError('Identifier not found');
  }

  const localRecord = await getLinkRegistrationByIdrLinkId(linkId, identifierId, tenantId);
  if (!localRecord) {
    throw new NotFoundError('Link registration not found');
  }

  const scheme = identifier.scheme;
  const registrar = scheme.registrar;

  logger.info({ identifierId, linkId }, 'Resolving IDR service for link deletion');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  try {
    logger.info({ identifierId, linkId }, 'Deleting link from upstream IDR');
    await idrService.deleteLink(linkId);
  } catch (idrError: unknown) {
    if (idrError instanceof IdrLinkNotFoundError) {
      logger.warn({ identifierId, linkId }, 'Link desync — already absent from upstream IDR');
    } else {
      throw idrError;
    }
  }

  logger.info({ identifierId, linkId }, 'Cleaning up local link record');
  await deleteLinkRegistration(linkId, identifierId, tenantId);

  logger.info({ identifierId, linkId }, 'Link deleted');
  return new Response(null, { status: 204 });
});
