import { NextResponse } from 'next/server';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';
import { handleRouteError } from '@/lib/api/handle-route-error';
import { apiLogger } from '@/lib/api/logger';
import { resolveServiceAccountUser } from '@/lib/api/service-account-user';

// Re-export for backwards compatibility — consumers that import from
// this module will continue to work during migration.
export { handleRouteError } from '@/lib/api/handle-route-error';

export interface TenantAuthContext {
  userId: string;
  tenantId: string;
  params: Promise<Record<string, string>>;
  authMethod: 'session' | 'service-account';
  serviceAccountClientId?: string;
}

type RouteHandler = (req: Request, context: TenantAuthContext) => Promise<Response>;

export function withTenantAuth(handler: RouteHandler) {
  return async (req: Request, routeContext: { params: Promise<Record<string, string>> }) => {
    const method = req.method;
    const url = new URL(req.url);
    const path = url.pathname;
    const start = Date.now();

    apiLogger.info({ method, path }, 'Request received');

    // Try session-based auth first
    const sessionUserId = await getSessionUserId();
    if (sessionUserId) {
      const tenantId = await getTenantId(sessionUserId);
      if (!tenantId) {
        apiLogger.warn(
          { method, path, userId: sessionUserId, durationMs: Date.now() - start },
          'Forbidden — no tenant',
        );
        return NextResponse.json({ ok: false, error: 'No tenant found for user' }, { status: 403 });
      }

      return executeHandler(
        handler,
        req,
        {
          userId: sessionUserId,
          tenantId,
          params: routeContext.params,
          authMethod: 'session',
        },
        method,
        path,
        start,
      );
    }

    // Fall back to service account auth via x-auth-sub header
    const sub = req.headers.get('x-auth-sub');
    if (sub) {
      const name = req.headers.get('x-auth-name') ?? undefined;
      const email = req.headers.get('x-auth-email') ?? undefined;
      const azp = req.headers.get('x-auth-azp') ?? undefined;

      let resolved: { userId: string; tenantId: string } | null;
      try {
        resolved = await resolveServiceAccountUser({ sub, name, email });
      } catch (error) {
        apiLogger.error(
          { method, path, sub, error, durationMs: Date.now() - start },
          'Service account user resolution failed unexpectedly',
        );
        return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
      }

      if (!resolved) {
        apiLogger.warn(
          { method, path, sub, durationMs: Date.now() - start },
          'Unauthorised — service account user resolution failed',
        );
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }

      return executeHandler(
        handler,
        req,
        {
          userId: resolved.userId,
          tenantId: resolved.tenantId,
          params: routeContext.params,
          authMethod: 'service-account',
          serviceAccountClientId: azp,
        },
        method,
        path,
        start,
      );
    }

    apiLogger.warn({ method, path, durationMs: Date.now() - start }, 'Unauthorised — no session or service account');
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  };
}

async function executeHandler(
  handler: RouteHandler,
  req: Request,
  context: TenantAuthContext,
  method: string,
  path: string,
  start: number,
): Promise<Response> {
  try {
    const response = await handler(req, context);

    apiLogger.info(
      { method, path, tenantId: context.tenantId, status: response.status, durationMs: Date.now() - start },
      'Request completed',
    );
    return response;
  } catch (e: unknown) {
    const errorResponse = handleRouteError(e);
    const logLevel = errorResponse.status >= 500 ? 'error' : 'warn';
    apiLogger[logLevel](
      { method, path, tenantId: context.tenantId, status: errorResponse.status, durationMs: Date.now() - start },
      'Request completed with error',
    );
    return errorResponse;
  }
}
