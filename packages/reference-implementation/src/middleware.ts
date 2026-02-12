/**
 * API Route Protection Middleware
 *
 * Protects /api/v1/* routes only.
 *
 * Supports two authentication methods:
 * 1. Session-based auth (NextAuth.js session cookies)
 * 2. Service account Bearer tokens (for machine-to-machine auth)
 */

import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/auth.config';
import { NextResponse, type NextRequest } from 'next/server';
import { validateServiceAccountToken, extractBearerToken } from '@/lib/auth/token-validator';
import { runWithCorrelationId } from '@uncefact/untp-ri-services';
import { randomUUID } from 'crypto';

const { auth } = NextAuth(authConfig);

/**
 * Validates a Bearer token from the Authorization header.
 */
async function validateBearerAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    return false;
  }

  const result = await validateServiceAccountToken(token);
  return result.valid;
}

export default auth(async (req) => {
  const correlationId = req.headers.get('x-correlation-id') || req.headers.get('x-amzn-trace-id') || randomUUID();

  return runWithCorrelationId(correlationId, async () => {
    const { pathname } = req.nextUrl;
    const isSessionAuthenticated = !!req.auth;

    // For API routes, check authentication
    if (pathname.startsWith('/api/v1/')) {
      // check session-based auth first
      if (isSessionAuthenticated) {
        const response = NextResponse.next();
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }

      // check Bearer token for service account auth
      const isBearerAuthenticated = await validateBearerAuth(req);
      if (isBearerAuthenticated) {
        const response = NextResponse.next();
        response.headers.set('x-correlation-id', correlationId);
        return response;
      }

      // user is unauthorized
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
