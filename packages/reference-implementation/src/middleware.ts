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
import { runWithCorrelationId } from '@uncefact/untp-ri-services/logging';
import type { JWTPayload } from 'jose';

const { auth } = NextAuth(authConfig);

/**
 * Strips all x-auth-* headers from the incoming request to prevent spoofing.
 */
function stripAuthHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);
  for (const key of [...cleaned.keys()]) {
    if (key.startsWith('x-auth-')) {
      cleaned.delete(key);
    }
  }
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
  const correlationId =
    req.headers.get('x-correlation-id') || req.headers.get('x-amzn-trace-id') || crypto.randomUUID();

  return runWithCorrelationId(correlationId, async () => {
    const { pathname } = req.nextUrl;
    const isSessionAuthenticated = !!req.auth;

    // For API routes, check authentication
    if (pathname.startsWith('/api/v1/')) {
      // Strip x-auth-* headers from incoming request to prevent spoofing
      const requestHeaders = stripAuthHeaders(req.headers);

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
