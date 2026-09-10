import { NextResponse } from 'next/server';

const ROUTE_RETIRED_CODE = 'ROUTE_RETIRED';

/** Formats the replacement pointer in the retirement response required by ADR-052 decision 3. */
export function retiredRouteMessage(replacement: string): string {
  return `This route has been retired. Use ${replacement} instead.`;
}

/**
 * The withTenantAuth wrappers authenticate before calling this helper. It builds
 * the 410 body and header. ADR-052 decision 3 fixes the status, code and
 * replacement pointer. A shared cache already must not store a response to an
 * Authorization-bearing request under RFC 9111 section 3.5, but a private
 * cache may heuristically cache a 410. Live library responses set this same
 * header, so the retirement response does too.
 */
export function retiredRoute(replacement: string): Response {
  return NextResponse.json(
    { error: retiredRouteMessage(replacement), code: ROUTE_RETIRED_CODE },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
