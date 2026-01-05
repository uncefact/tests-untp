/**
 * API Route Protection Middleware
 *
 * Protects /api/v1/* routes with dual authentication:
 * 1. Bearer token authentication (for service accounts)
 * 2. NextAuth session authentication (for browser clients)
 */

import { authConfig } from "@/lib/auth/auth.config";
import { extractBearerToken, validateBearerToken } from "@/lib/auth/bearer";
import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

/**
 * Attempts to authenticate request using Bearer token
 */
async function authenticateWithBearer(
  request: NextRequest
): Promise<{ isAuthenticated: boolean; error?: string }> {
  const authHeader = request.headers.get("authorization");
  const token = extractBearerToken(authHeader);

  console.log({token})

  if (!token) {
    return { isAuthenticated: false };
  }

  const result = await validateBearerToken(token);

  if (result.valid) {
    return { isAuthenticated: true };
  }

  // Token was provided but invalid - return error to prevent fallback
  return { isAuthenticated: false, error: result.error };
}

/**
 * Main middleware handler
 *
 * Authentication flow:
 * 1. Check for Bearer token in Authorization header
 *    - If valid: allow request
 *    - If invalid: return 401 (do not fall back to session)
 * 2. If no Bearer token: check NextAuth session
 *    - If valid: allow request
 *    - If invalid: return 401
 */
export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  // Only protect /api/v1/* routes
  if (!pathname.startsWith("/api/v1/")) {
    return NextResponse.next();
  }

  // Step 1: Try Bearer token authentication
  const bearerResult = await authenticateWithBearer(req);

  if (bearerResult.isAuthenticated) {
    return NextResponse.next();
  }

  if (bearerResult.error) {
    // Bearer token was provided but invalid - do not fall back to session
    return NextResponse.json(
      { error: "Unauthorized", message: bearerResult.error },
      { status: 401 }
    );
  }

  // Step 2: No Bearer token - fall back to NextAuth session
  const isSessionAuthenticated = !!req.auth;

  if (!isSessionAuthenticated) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  return NextResponse.next();
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
    "/api/v1/:path*",
  ],
};
