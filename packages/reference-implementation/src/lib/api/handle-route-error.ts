import { NextResponse } from 'next/server';
import { NotFoundError, errorMessage, ServiceRegistryError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ handler: 'error' });

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
    logger.warn({ err: e }, 'Validation error');
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
  if (e instanceof NotFoundError) {
    logger.warn({ err: e }, 'Not found');
    return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
  }
  if (e instanceof ServiceRegistryError) {
    const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
    logger.error({ err: e, status }, 'Service registry error');
    return NextResponse.json({ ok: false, error: e.message }, { status });
  }
  if (e instanceof ServiceError) {
    logger.error({ err: e, code: e.code, status: e.statusCode }, 'Service error');
    return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.statusCode });
  }
  logger.error({ err: e }, 'Unexpected error');
  return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
}
