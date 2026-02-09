import { NextResponse } from 'next/server';
import { resolveDidService } from '@/lib/services/resolve-did-service';
import { ServiceRegistryError, errorMessage } from '@/lib/api/errors';
import { ValidationError, validateEnum, parsePositiveInt, parseNonNegativeInt } from '@/lib/api/validation';
import { withOrgAuth } from '@/lib/api/with-org-auth';
import { createDid, listDids } from '@/lib/prisma/repositories';
import { CREATABLE_DID_TYPES, DidType, DidMethod, DidStatus } from '@uncefact/untp-ri-services';

export const POST = withOrgAuth(async (req, { organizationId }) => {
  let body: {
    type?: string;
    method?: string;
    alias?: string;
    name?: string;
    description?: string;
    serviceInstanceId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const type = validateEnum(body.type, CREATABLE_DID_TYPES, 'type');
    if (!type) throw new ValidationError('type is required');

    const method = validateEnum(body.method, Object.values(DidMethod), 'method');
    if (!method) throw new ValidationError('method is required');

    if (!body.alias || typeof body.alias !== 'string') {
      throw new ValidationError('alias is required');
    }

    const { service: didService, instanceId: serviceInstanceId } = await resolveDidService(
      organizationId,
      body.serviceInstanceId,
    );

    validateEnum(type, didService.getSupportedTypes(), 'type');
    validateEnum(method, didService.getSupportedMethods(), 'method');

    let normalisedAlias: string;
    try {
      normalisedAlias = didService.normaliseAlias(body.alias, method);
    } catch (aliasErr) {
      throw new ValidationError(errorMessage(aliasErr, 'Invalid alias'));
    }

    const providerResult = await didService.create({
      type,
      method,
      alias: normalisedAlias,
      name: body.name,
      description: body.description,
    });

    const status = type === DidType.SELF_MANAGED ? DidStatus.UNVERIFIED : DidStatus.ACTIVE;

    const record = await createDid({
      organizationId,
      did: providerResult.did,
      type,
      method,
      keyId: providerResult.keyId,
      name: body.name ?? providerResult.did,
      description: body.description,
      status,
      serviceInstanceId,
    });

    return NextResponse.json({ ok: true, did: record }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    if (e instanceof ServiceRegistryError) {
      const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
      return NextResponse.json({ ok: false, error: e.message }, { status });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});

export const GET = withOrgAuth(async (req, { organizationId }) => {
  const url = new URL(req.url);

  try {
    const type = validateEnum(url.searchParams.get('type') ?? undefined, Object.values(DidType), 'type');
    const status = validateEnum(url.searchParams.get('status') ?? undefined, Object.values(DidStatus), 'status');
    const serviceInstanceId = url.searchParams.get('serviceInstanceId') ?? undefined;
    const limit = parsePositiveInt(url.searchParams.get('limit'), 'limit');
    const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset');

    const dids = await listDids(organizationId, {
      type,
      status,
      serviceInstanceId,
      limit,
      offset,
    });

    return NextResponse.json({ ok: true, dids });
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error('[api] Unexpected error:', e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
