/**
 * API Route Protection Middleware
 *
 * Protects /api/v1/* routes only.
 *
 * Supports two authentication methods:
 * 1. Session-based auth (NextAuth.js session cookies)
 * 2. Service account Bearer tokens (for machine-to-machine auth)
 *
 * For service account (Bearer) auth, JWT claims are propagated as
 * request headers (x-auth-sub, x-auth-azp, x-auth-name, x-auth-email)
 * so downstream route handlers can identify the caller without
 * re-validating the token.
 *
 * All incoming x-auth-* headers are stripped before auth logic runs
 * to prevent header spoofing.
 */

import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/auth.config';
import { NextResponse, type NextRequest } from 'next/server';
import { validateServiceAccountToken, extractBearerToken } from '@/lib/auth/token-validator';
import { runWithRequestContext, isValidCorrelationId, amznTraceRootToken } from '@uncefact/untp-ri-services/logging';
import type { JWTPayload } from 'jose';

const { auth } = NextAuth(authConfig);

/** Routes under /api/v1/ that do not require authentication. */
const PUBLIC_API_ROUTES = new Set(['/api/v1/credentials/verify']);

/**
 * Strips all x-auth-* headers from the incoming request to prevent spoofing.
 */
function stripAuthHeaders(headers: Headers, correlationId: string): Headers {
  const cleaned = new Headers(headers);
  for (const key of [...cleaned.keys()]) {
    if (key.startsWith('x-auth-')) {
      cleaned.delete(key);
    }
  }
  // Forward the validated-or-minted ID so route handlers, log lines, and
  // outbound calls all use the same ID the response echoes back to the
  // caller; without this a missing or malformed inbound ID splits into one
  // ID on the response and a different one everywhere else (#654).
  cleaned.set('x-correlation-id', correlationId);
  return cleaned;
}

/**
 * Validates a Bearer token and returns the JWT payload if valid.
 */
async function validateBearerAuth(req: NextRequest): Promise<JWTPayload | null> {
  const authHeader = req.headers.get('authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    return null;
  }

  const result = await validateServiceAccountToken(token);
  return result.valid && result.payload ? result.payload : null;
}

export default auth(async (req) => {
  // Zero trust at the boundary (#654): an inbound ID outside the shared
  // length/charset rule is replaced, never echoed into logs or responses.
  // Behind an AWS ALB the trace header's Root token joins RI logs to ALB
  // access logs and X-Ray; the raw header never validates, the token does.
  const inbound = req.headers.get('x-correlation-id');
  const amznTrace = req.headers.get('x-amzn-trace-id');
  const correlationId =
    inbound && isValidCorrelationId(inbound)
      ? inbound
      : (amznTrace && amznTraceRootToken(amznTrace)) || crypto.randomUUID();

  return runWithRequestContext(correlationId, async () => {
    const { pathname } = req.nextUrl;
    const isSessionAuthenticated = !!req.auth;

    // For API routes, check authentication
    if (pathname.startsWith('/api/v1/')) {
      // Allow public API routes through without authentication
      if (PUBLIC_API_ROUTES.has(pathname)) {
        const requestHeaders = stripAuthHeaders(req.headers, correlationId);
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }

      // Strip x-auth-* headers from incoming request to prevent spoofing
      const requestHeaders = stripAuthHeaders(req.headers, correlationId);

      // Check session-based auth first
      if (isSessionAuthenticated) {
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }

      // Check Bearer token for service account auth
      const payload = await validateBearerAuth(req);
      if (payload) {
        // sub is required for the service account flow to work
        if (!payload.sub) {
          return NextResponse.json(
            { error: 'Unauthorized', message: 'Token missing required "sub" claim' },
            { status: 401, headers: { 'x-correlation-id': correlationId } },
          );
        }

        // Propagate JWT claims as request headers for downstream route handlers
        requestHeaders.set('x-auth-sub', payload.sub);

        const azp = payload['azp'];
        if (azp && typeof azp === 'string') {
          requestHeaders.set('x-auth-azp', azp);
        }

        const name = payload['name'];
        if (name && typeof name === 'string') {
          requestHeaders.set('x-auth-name', name);
        }

        const email = payload['email'];
        if (email && typeof email === 'string') {
          requestHeaders.set('x-auth-email', email);
        }

        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }

      // User is unauthorised
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401, headers: { 'x-correlation-id': correlationId } },
      );
    }

    return NextResponse.next();
  });
});

/**
 * Middleware Matcher Configuration
 *
 * This middleware ONLY protects API routes.
 * Protected page routes are handled by the (protected) layout.
 *
 * Protected by middleware:
 * - /api/v1/* - All versioned API endpoints
 *
 * Unprotected (bypasses middleware):
 * - /api/auth/* - NextAuth.js endpoints
 * - All page routes - Protected routes checked in layout
 */
export const config = {
  matcher: [
    /*
     * Match all versioned API routes under /api/v1/*
     */
    '/api/v1/:path*',
  ],
};
