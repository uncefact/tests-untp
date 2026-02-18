import { NextResponse } from 'next/server';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';
import { handleRouteError } from '@/lib/api/handle-route-error';
import { apiLogger } from '@/lib/api/logger';
import { resolveServiceAccountUser } from '@/lib/api/service-account-user';
import { getTenantConfig } from '@/lib/auth/tenant-config';
import { extractGroupClaim } from '@/lib/auth/group-claim';
import { resolveClosedModeTenant } from '@/lib/api/resolve-closed-mode-tenant';
import { validateServiceAccountToken, extractBearerToken } from '@/lib/auth/token-validator';
import { prisma } from '@/lib/prisma/prisma';
import { auth } from '@/auth';

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
    const tenantConfig = getTenantConfig();

    apiLogger.info({ method, path }, 'Request received');

    if (tenantConfig.mode === 'closed') {
      return handleClosedMode(handler, req, routeContext, method, path, start, tenantConfig);
    }

    return handleOpenMode(handler, req, routeContext, method, path, start);
  };
}

async function handleClosedMode(
  handler: RouteHandler,
  req: Request,
  routeContext: { params: Promise<Record<string, string>> },
  method: string,
  path: string,
  start: number,
  tenantConfig: { mode: 'closed'; claimName: string; claimFormat: 'array_first' | 'string' },
): Promise<Response> {
  // --- Session path ---
  const session = await auth();
  if (session?.user?.id) {
    if (session.error === 'RefreshAccessTokenError') {
      apiLogger.warn(
        { method, path, userId: session.user.id, durationMs: Date.now() - start },
        'Unauthorised — session token refresh failed',
      );
      return NextResponse.json({ ok: false, error: 'Session expired — please sign in again' }, { status: 401 });
    }

    if (!session.group_claim) {
      apiLogger.warn(
        { method, path, userId: session.user.id, durationMs: Date.now() - start },
        'Forbidden — no group claim in session',
      );
      return NextResponse.json({ ok: false, error: 'No group assignment found' }, { status: 403 });
    }

    // Look up tenant by group claim
    const tenant = await prisma.tenant.findUnique({
      where: { externalIdpGroupId: session.group_claim },
      select: { id: true },
    });

    if (!tenant) {
      apiLogger.warn(
        { method, path, groupClaim: session.group_claim, durationMs: Date.now() - start },
        'Forbidden — no tenant for group claim',
      );
      return NextResponse.json({ ok: false, error: 'No tenant found for group' }, { status: 403 });
    }

    // Ensure user is linked to the correct tenant (handles group changes)
    await prisma.user.update({
      where: { id: session.user.id },
      data: { tenantId: tenant.id },
    });

    return executeHandler(
      handler,
      req,
      {
        userId: session.user.id,
        tenantId: tenant.id,
        params: routeContext.params,
        authMethod: 'session',
      },
      method,
      path,
      start,
    );
  }

  // --- Bearer token path ---
  const authHeader = req.headers.get('authorization');
  const bearerToken = extractBearerToken(authHeader);

  if (bearerToken) {
    const validationResult = await validateServiceAccountToken(bearerToken);

    if (!validationResult.valid || !validationResult.payload) {
      apiLogger.warn(
        { method, path, error: validationResult.error, durationMs: Date.now() - start },
        'Unauthorised — invalid bearer token',
      );
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = validationResult.payload;
    if (!payload.sub) {
      return NextResponse.json({ ok: false, error: 'Token missing required sub claim' }, { status: 401 });
    }

    const groupClaim = extractGroupClaim(payload as Record<string, unknown>, tenantConfig);

    if (!groupClaim) {
      apiLogger.warn(
        { method, path, sub: payload.sub, durationMs: Date.now() - start },
        'Forbidden — no group claim in bearer token',
      );
      return NextResponse.json({ ok: false, error: 'No group assignment found in token' }, { status: 403 });
    }

    const resolved = await resolveClosedModeTenant(groupClaim, payload.sub, {
      name: typeof payload.name === 'string' ? payload.name : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    });

    if (!resolved) {
      apiLogger.error(
        { method, path, sub: payload.sub, durationMs: Date.now() - start },
        'Failed to resolve closed mode tenant for bearer token',
      );
      return NextResponse.json({ ok: false, error: 'Failed to resolve tenant' }, { status: 500 });
    }

    const azp = payload.azp;
    return executeHandler(
      handler,
      req,
      {
        userId: resolved.userId,
        tenantId: resolved.tenantId,
        params: routeContext.params,
        authMethod: 'service-account',
        serviceAccountClientId: typeof azp === 'string' ? azp : undefined,
      },
      method,
      path,
      start,
    );
  }

  apiLogger.warn({ method, path, durationMs: Date.now() - start }, 'Unauthorised — no session or bearer token');
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}

async function handleOpenMode(
  handler: RouteHandler,
  req: Request,
  routeContext: { params: Promise<Record<string, string>> },
  method: string,
  path: string,
  start: number,
): Promise<Response> {
  // Try session-based auth first
  const sessionUserId = await getSessionUserId();
  if (sessionUserId) {
    const tenantId = await getTenantId(sessionUserId);
    if (!tenantId) {
      apiLogger.warn({ method, path, userId: sessionUserId, durationMs: Date.now() - start }, 'Forbidden — no tenant');
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
