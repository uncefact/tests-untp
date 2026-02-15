import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import {
  getIdentifierById,
  getLinkRegistrationByIdrLinkId,
  updateLinkRegistration,
  deleteLinkRegistration,
} from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';
import { IdrLinkNotFoundError } from '@uncefact/untp-ri-services';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/identifiers/[id]/links/[linkId]' });

/**
 * @swagger
 * /identifiers/{id}/links/{linkId}:
 *   get:
 *     tags: [Links]
 *     summary: Get a link by IDR link ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Link details (includes desync flag if upstream link is missing)
 *       404:
 *         description: Link not found
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id: identifierId, linkId } = await params;

  logger.info({ tenantId, identifierId, linkId }, 'Looking up identifier and local link record');
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

  logger.info({ tenantId, identifierId, linkId }, 'Resolving IDR service for link retrieval');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  try {
    logger.info({ tenantId, identifierId, linkId }, 'Fetching live link data from IDR');
    const link = await idrService.getLinkById(linkId);
    return NextResponse.json({ ok: true, link, localRecord });
  } catch (idrError: unknown) {
    if (idrError instanceof IdrLinkNotFoundError) {
      logger.warn({ tenantId, identifierId, linkId }, 'Link desync — exists locally but missing from upstream IDR');
      return NextResponse.json(
        {
          ok: true,
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
 *     tags: [Links]
 *     summary: Update a link
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Link updated
 *       404:
 *         description: Link not found
 *       409:
 *         description: Desynchronisation - link no longer exists on the upstream IDR
 */
export const PATCH = withTenantAuth(async (req, { tenantId, params }) => {
  const { id: identifierId, linkId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  logger.info({ tenantId, identifierId, linkId }, 'Looking up identifier and local link record for update');
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

  logger.info({ tenantId, identifierId, linkId }, 'Resolving IDR service for link update');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  try {
    logger.info({ tenantId, identifierId, linkId }, 'Updating link on upstream IDR');
    const updatedLink = await idrService.updateLink(linkId, body);

    logger.info({ tenantId, identifierId, linkId }, 'Syncing local record with upstream state');
    await updateLinkRegistration(linkId, identifierId, tenantId, {
      linkType: updatedLink.rel,
      targetUrl: updatedLink.href,
      mimeType: updatedLink.type,
    });

    logger.info({ tenantId, identifierId, linkId }, 'Link updated');
    return NextResponse.json({ ok: true, link: updatedLink });
  } catch (e: unknown) {
    if (e instanceof IdrLinkNotFoundError) {
      logger.warn({ tenantId, identifierId, linkId }, 'Link desync — cannot update, missing from upstream IDR');
      return NextResponse.json(
        {
          ok: false,
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
 *     tags: [Links]
 *     summary: Delete a link
 *     description: >
 *       Deletes a link from both the upstream IDR and the local record.
 *       If the link has already been removed from the upstream IDR (out-of-band),
 *       the local record is still cleaned up and the response includes a desync warning.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Link deleted (may include desync warning if upstream link was already gone)
 *       404:
 *         description: Link not found
 */
export const DELETE = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id: identifierId, linkId } = await params;

  logger.info({ tenantId, identifierId, linkId }, 'Looking up identifier and local link record for deletion');
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

  logger.info({ tenantId, identifierId, linkId }, 'Resolving IDR service for link deletion');
  const { service: idrService } = await resolveIdrService(
    tenantId,
    scheme.idrServiceInstanceId,
    registrar.idrServiceInstanceId,
  );

  let desync = false;
  try {
    logger.info({ tenantId, identifierId, linkId }, 'Deleting link from upstream IDR');
    await idrService.deleteLink(linkId);
  } catch (idrError: unknown) {
    if (idrError instanceof IdrLinkNotFoundError) {
      logger.warn({ tenantId, identifierId, linkId }, 'Link desync — already absent from upstream IDR');
      desync = true;
    } else {
      throw idrError;
    }
  }

  logger.info({ tenantId, identifierId, linkId }, 'Cleaning up local link record');
  await deleteLinkRegistration(linkId, identifierId, tenantId);

  logger.info({ tenantId, identifierId, linkId, desync }, 'Link deleted');
  return NextResponse.json({
    ok: true,
    deleted: true,
    ...(desync && {
      desync: true,
      warning: `Link "${linkId}" was already absent from the upstream IDR. Local record cleaned up.`,
    }),
  });
});
