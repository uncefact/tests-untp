import { NextResponse } from 'next/server';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';

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

    return handler(req, {
      userId,
      tenantId,
      params: routeContext.params,
    });
  };
}
