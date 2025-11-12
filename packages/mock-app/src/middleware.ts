/**
 * API Route Protection Middleware
 *
 * Protects /api/v1/* routes only.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;

  // For API routes, return 401 if not authenticated
  if (pathname.startsWith("/api/v1/")) {
    if (!isAuthenticated) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.next();
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
