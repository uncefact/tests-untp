import { NextResponse } from 'next/server';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';
import { NotFoundError, errorMessage, ServiceRegistryError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';

export interface TenantAuthContext {
  userId: string;
  tenantId: string;
  params: Promise<Record<string, string>>;
}

type RouteHandler = (req: Request, context: TenantAuthContext) => Promise<Response>;

export function withTenantAuth(handler: RouteHandler) {
  return async (req: Request, routeContext: { params: Promise<Record<string, string>> }) => {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = await getTenantId(userId);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: 'No tenant found for user' }, { status: 403 });
    }

    try {
      return await handler(req, {
        userId,
        tenantId,
        params: routeContext.params,
      });
    } catch (e: unknown) {
      return handleRouteError(e);
    }
  };
}

/**
 * Centralised error-to-HTTP-response mapper.
 *
 * Order matters — more specific error types must come before their parents.
 * ServiceError is checked before the generic fallthrough because its subclasses
 * (IdrError, DidError, etc.) carry statusCode and code for structured responses.
 */
export function handleRouteError(e: unknown): Response {
  if (e instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
  }
  if (e instanceof ServiceRegistryError) {
    console.error('[api] Service registry error:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  if (e instanceof ServiceError) {
    console.error(`[api] Service error [${e.code}]:`, e.message);
    return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.statusCode });
  }
  console.error('[api] Unexpected error:', e);
  return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
}
