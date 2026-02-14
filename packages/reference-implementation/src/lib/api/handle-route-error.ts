import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage, ServiceRegistryError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';

/**
 * Centralised error-to-HTTP-response mapper.
 *
 * Order matters -- more specific error types must come before their parents.
 * ServiceError is checked before the generic fallthrough because its subclasses
 * (IdrError, DidError, etc.) carry statusCode and code for structured responses.
 *
 * ServiceRegistryError handling distinguishes between sub-types:
 *   - ServiceInstanceNotFoundError (name check) returns 404
 *   - All other registry errors return 500
 */
export function handleRouteError(e: unknown): Response {
  if (e instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
  }
  if (e instanceof ServiceRegistryError) {
    const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
    console.error('[api] Service registry error:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status });
  }
  if (e instanceof ServiceError) {
    console.error(`[api] Service error [${e.code}]:`, e.message);
    return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.statusCode });
  }
  console.error('[api] Unexpected error:', e);
  return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
}
