import { NextResponse } from 'next/server';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';
import { handleRouteError } from '@/lib/api/handle-route-error';

// Re-export for backwards compatibility — consumers that import from
// this module will continue to work during migration.
export { handleRouteError } from '@/lib/api/handle-route-error';

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
