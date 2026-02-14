import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage, ServiceRegistryError } from '@/lib/api/errors';
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

/**
 * @swagger
 * /api/v1/identifiers/{id}/links/{linkId}:
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

  try {
    const identifier = await getIdentifierById(identifierId, tenantId);
    if (!identifier) {
      throw new NotFoundError('Identifier not found');
    }

    const localRecord = await getLinkRegistrationByIdrLinkId(linkId, identifierId, tenantId);
    if (!localRecord) {
      throw new NotFoundError('Link registration not found');
    }

    // Get live link data from IDR service
    const scheme = (identifier as any).scheme;
    const registrar = scheme?.registrar;

    const { service: idrService } = await resolveIdrService(
      tenantId,
      scheme?.idrServiceInstanceId,
      registrar?.idrServiceInstanceId,
    );

    try {
      const link = await idrService.getLinkById(linkId);
      return NextResponse.json({ ok: true, link, localRecord });
    } catch (idrError: unknown) {
      if (idrError instanceof IdrLinkNotFoundError) {
        // Link exists locally but has been removed from the upstream IDR
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
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ServiceRegistryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});

/**
 * @swagger
 * /api/v1/identifiers/{id}/links/{linkId}:
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
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const identifier = await getIdentifierById(identifierId, tenantId);
    if (!identifier) {
      throw new NotFoundError('Identifier not found');
    }

    const localRecord = await getLinkRegistrationByIdrLinkId(linkId, identifierId, tenantId);
    if (!localRecord) {
      throw new NotFoundError('Link registration not found');
    }

    const scheme = (identifier as any).scheme;
    const registrar = scheme?.registrar;

    const { service: idrService } = await resolveIdrService(
      tenantId,
      scheme?.idrServiceInstanceId,
      registrar?.idrServiceInstanceId,
    );

    const updatedLink = await idrService.updateLink(linkId, body);

    // Sync local record with upstream state
    await updateLinkRegistration(linkId, identifierId, tenantId, {
      linkType: updatedLink.rel,
      targetUrl: updatedLink.href,
      mimeType: updatedLink.type,
    });

    return NextResponse.json({ ok: true, link: updatedLink });
  } catch (e: unknown) {
    if (e instanceof IdrLinkNotFoundError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Link "${linkId}" no longer exists on the upstream IDR. It may have been removed out-of-band. Delete the local record to resolve this desynchronisation.`,
          desync: true,
        },
        { status: 409 },
      );
    }
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ServiceRegistryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});

/**
 * @swagger
 * /api/v1/identifiers/{id}/links/{linkId}:
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

  try {
    const identifier = await getIdentifierById(identifierId, tenantId);
    if (!identifier) {
      throw new NotFoundError('Identifier not found');
    }

    const localRecord = await getLinkRegistrationByIdrLinkId(linkId, identifierId, tenantId);
    if (!localRecord) {
      throw new NotFoundError('Link registration not found');
    }

    const scheme = (identifier as any).scheme;
    const registrar = scheme?.registrar;

    const { service: idrService } = await resolveIdrService(
      tenantId,
      scheme?.idrServiceInstanceId,
      registrar?.idrServiceInstanceId,
    );

    // Attempt to delete from upstream IDR; if already gone, proceed with local cleanup
    let desync = false;
    try {
      await idrService.deleteLink(linkId);
    } catch (idrError: unknown) {
      if (idrError instanceof IdrLinkNotFoundError) {
        desync = true;
      } else {
        throw idrError;
      }
    }

    // Always clean up the local record
    await deleteLinkRegistration(linkId, identifierId, tenantId);

    return NextResponse.json({
      ok: true,
      deleted: true,
      ...(desync && {
        desync: true,
        warning: `Link "${linkId}" was already absent from the upstream IDR. Local record cleaned up.`,
      }),
    });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ServiceRegistryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
