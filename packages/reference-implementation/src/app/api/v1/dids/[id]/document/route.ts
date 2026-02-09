import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { NotFoundError, ServiceRegistryError, errorMessage } from '@/lib/api/errors';
import { withOrgAuth } from '@/lib/api/with-org-auth';
import { getDidById } from '@/lib/prisma/repositories';

export const GET = withOrgAuth(async (_req, { organizationId, params }) => {
  const { id } = await params;

  try {
    const did = await getDidById(id, organizationId);
    if (!did) {
      throw new NotFoundError('DID not found');
    }

    const { service: didService } = await resolveDidService(organizationId, did.serviceInstanceId ?? undefined);
    const document = await didService.getDocument(did.did);

    return NextResponse.json({ ok: true, document });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof ServiceRegistryError) {
      const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
      return NextResponse.json({ ok: false, error: e.message }, { status });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
