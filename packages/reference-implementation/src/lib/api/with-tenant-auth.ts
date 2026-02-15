import { NextResponse } from 'next/server';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';
import { handleRouteError } from '@/lib/api/handle-route-error';
import { apiLogger } from '@/lib/api/logger';

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
    const method = req.method;
    const url = new URL(req.url);
    const path = url.pathname;
    const start = Date.now();

    apiLogger.info({ method, path }, 'Request received');

    const userId = await getSessionUserId();
    if (!userId) {
      apiLogger.warn({ method, path, durationMs: Date.now() - start }, 'Unauthorised — no session');
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = await getTenantId(userId);
    if (!tenantId) {
      apiLogger.warn({ method, path, userId, durationMs: Date.now() - start }, 'Forbidden — no tenant');
      return NextResponse.json({ ok: false, error: 'No tenant found for user' }, { status: 403 });
    }

    try {
      const response = await handler(req, {
        userId,
        tenantId,
        params: routeContext.params,
      });

      apiLogger.info(
        { method, path, tenantId, status: response.status, durationMs: Date.now() - start },
        'Request completed',
      );
      return response;
    } catch (e: unknown) {
      const errorResponse = handleRouteError(e);
      apiLogger.info(
        { method, path, tenantId, status: errorResponse.status, durationMs: Date.now() - start },
        'Request completed with error',
      );
      return errorResponse;
    }
  };
}
