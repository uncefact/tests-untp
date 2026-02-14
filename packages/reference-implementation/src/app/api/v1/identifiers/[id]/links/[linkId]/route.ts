import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage, ServiceRegistryError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getIdentifierById, getLinkRegistrationByIdrLinkId, deleteLinkRegistration } from '@/lib/prisma/repositories';
import { resolveIdrService } from '@/lib/services/resolve-idr-service';

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
 *         description: Link details
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

    const link = await idrService.getLinkById(linkId);

    return NextResponse.json({ ok: true, link, localRecord });
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

    return NextResponse.json({ ok: true, link: updatedLink });
  } catch (e: unknown) {
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
 *         description: Link deleted
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

    // Delete from IDR service first
    await idrService.deleteLink(linkId);

    // Then delete local audit record
    await deleteLinkRegistration(linkId, identifierId, tenantId);

    return NextResponse.json({ ok: true, deleted: true });
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
