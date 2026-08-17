import { NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { getSessionUserId, getTenantId } from '@/lib/api/helpers';
import { handlePipelineError, handleRouteError } from '@/lib/api/handle-route-error';
import { unexpectedErrorMessage } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { resolveServiceAccountUser } from '@/lib/api/service-account-user';
import { getTenantConfig } from '@/lib/auth/tenant-config';
import { extractGroupClaim } from '@/lib/auth/group-claim';
import { resolveClosedModeTenant } from '@/lib/api/resolve-closed-mode-tenant';
import { validateServiceAccountToken, extractBearerToken } from '@/lib/auth/token-validator';
import { prisma } from '@/lib/prisma/prisma';
import { auth } from '@/auth';
import { runWithRequestContext, updateRequestContext, isValidCorrelationId } from '@uncefact/untp-ri-services/logging';

// Re-export for backwards compatibility — consumers that import from
// this module will continue to work during migration.
export { handleRouteError } from '@/lib/api/handle-route-error';

/** Fields added to the request-scoped logging context by the RI layer. */
interface RiRequestContext extends Record<string, unknown> {
  userId: string;
  tenantId: string;
}

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
    const start = Date.now();

    // Nothing may escape this wrapper: every route documents a 500 as an
    // ErrorResponse, and an uncaught throw would instead reach Next's
    // plain-text fallback. The inner boundary handles everything once the
    // request context exists, so a failure there is logged with its
    // correlation id; this outer one is the last resort for the context
    // establishment itself, which has no context to log against.
    try {
      // Zero trust at the boundary (#654): an inbound ID outside the shared
      // length/charset rule is replaced, never echoed into logs or responses.
      const raw = req.headers.get('x-correlation-id');
      const correlationId = raw && isValidCorrelationId(raw) ? raw : crypto.randomUUID();
      if (raw && correlationId !== raw) {
        apiLogger.warn(
          { inboundLength: raw.length, replacedWith: correlationId },
          'Rejected invalid x-correlation-id header; minted a fresh id',
        );
      }

      return await runWithRequestContext(correlationId, async () => {
        // Established before the try so the catch can still attribute a
        // failure that happens while working them out.
        let method = 'UNKNOWN';
        let path = 'unknown';

        try {
          method = req.method;
          path = new URL(req.url).pathname;

          // Carry the request method and path in the request context so every
          // downstream log entry, including a centrally-handled error, is
          // attributable to its route without each handler restating them. The
          // `request`-prefixed keys avoid colliding with per-log `method` fields
          // that some handlers already use for a domain concept (e.g. a DID method).
          updateRequestContext({ requestMethod: method, requestPath: path });

          apiLogger.info({ method, path }, 'Request received');

          // Read inside the boundary so a throw here is answered rather than
          // escaping. Note that invalid tenant configuration does not reach
          // this point in practice: auth.config.ts calls getTenantConfig() at
          // module scope, so a bad TENANT_MODE fails the route module's import
          // and never runs a request. That fail-fast behaviour is deliberate
          // and outside this boundary.
          const tenantConfig = getTenantConfig();

          // Awaited rather than returned: an unawaited promise's rejection
          // would not land in this catch.
          if (tenantConfig.mode === 'closed') {
            return await handleClosedMode(handler, req, routeContext, method, path, start, tenantConfig);
          }

          return await handleOpenMode(handler, req, routeContext, method, path, start);
        } catch (error: unknown) {
          return respondToPipelineFailure(error, method, path, start);
        }
      });
    } catch (error: unknown) {
      unstable_rethrow(error);

      apiLogger.error(
        { err: error, durationMs: Date.now() - start },
        'Request failed before the request context was established',
      );
      // Outside the request context by definition, so there is no correlation
      // id to quote; the log line above is the only record of this failure.
      return NextResponse.json({ error: unexpectedErrorMessage(undefined) }, { status: 500 });
    }
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
      return NextResponse.json({ error: 'Session expired. Please sign in again' }, { status: 401 });
    }

    if (!session.group_claim) {
      apiLogger.warn(
        { method, path, userId: session.user.id, durationMs: Date.now() - start },
        'Forbidden — no group claim in session',
      );
      return NextResponse.json({ error: 'No group assignment found' }, { status: 403 });
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
      return NextResponse.json({ error: 'No tenant found for group' }, { status: 403 });
    }

    // Ensure user is linked to the correct tenant (handles group changes)
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { tenantId: true },
    });

    if (dbUser && dbUser.tenantId !== tenant.id) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { tenantId: tenant.id },
      });
    }

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
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const payload = validationResult.payload;
    if (!payload.sub) {
      return NextResponse.json({ error: 'Token missing required sub claim' }, { status: 401 });
    }

    const groupClaim = extractGroupClaim(payload as Record<string, unknown>, tenantConfig);

    if (!groupClaim) {
      apiLogger.warn(
        { method, path, sub: payload.sub, durationMs: Date.now() - start },
        'Forbidden — no group claim in bearer token',
      );
      return NextResponse.json({ error: 'No group assignment found in token' }, { status: 403 });
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
      return NextResponse.json({ error: 'Failed to resolve tenant' }, { status: 500 });
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
  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
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
      return NextResponse.json({ error: 'No tenant found for user' }, { status: 403 });
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

    // No local catch: an unexpected failure here joins the wrapper's central
    // boundary, so it is logged and answered like every other pre-handler
    // failure rather than through a second, differently-worded 500. The
    // subject goes on the request context first, so a failure is still
    // attributable to a service account without that catch's own log line.
    updateRequestContext({ serviceAccountSub: sub });
    const resolved = await resolveServiceAccountUser({ sub, name, email });

    if (!resolved) {
      apiLogger.warn(
        { method, path, sub, durationMs: Date.now() - start },
        'Unauthorised — service account user resolution failed',
      );
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
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
  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
}

/**
 * Maps an unexpected failure from the auth-and-tenant-resolution pipeline to
 * the documented ErrorResponse body.
 *
 * Typed API errors and database errors keep their existing mapping; an
 * unmapped error is redacted to the canned message, because echoing it here
 * would newly disclose session, cookie and auth-provider detail that Next's
 * own uncaught path never returns. Redaction is scoped to this pipeline: a
 * handler that throws an unmapped error still echoes its message, which is
 * the established route contract and is deliberately left alone here.
 */
function respondToPipelineFailure(error: unknown, method: string, path: string, start: number): Response {
  // Next signals redirects and similar framework control flow by throwing;
  // those must pass through untouched rather than becoming a 500.
  unstable_rethrow(error);

  const response = handlePipelineError(error);

  // The error itself is already logged by the mapper; this line is the
  // completion record, matching what executeHandler emits for handler
  // failures, including its status-derived level.
  const level = response.status >= 500 ? 'error' : 'warn';
  apiLogger[level](
    { method, path, status: response.status, durationMs: Date.now() - start },
    'Request failed before the handler ran',
  );
  return response;
}

async function executeHandler(
  handler: RouteHandler,
  req: Request,
  context: TenantAuthContext,
  method: string,
  path: string,
  start: number,
): Promise<Response> {
  // Enrich request context so all downstream log entries include userId and tenantId.
  updateRequestContext<RiRequestContext>({ userId: context.userId, tenantId: context.tenantId });

  try {
    const response = await handler(req, context);

    apiLogger.info(
      { method, path, tenantId: context.tenantId, status: response.status, durationMs: Date.now() - start },
      'Request completed',
    );
    return response;
  } catch (e: unknown) {
    unstable_rethrow(e);
    const errorResponse = handleRouteError(e);
    const logLevel = errorResponse.status >= 500 ? 'error' : 'warn';
    apiLogger[logLevel](
      { method, path, tenantId: context.tenantId, status: errorResponse.status, durationMs: Date.now() - start },
      'Request completed with error',
    );
    return errorResponse;
  }
}
