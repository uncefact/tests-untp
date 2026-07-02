import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
  errorMessage,
  ServiceRegistryError,
} from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { isDatabaseError } from '@/lib/prisma/db-errors';
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
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (e instanceof ForbiddenError) {
    logger.warn({ err: e }, 'Forbidden');
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (e instanceof NotFoundError) {
    logger.warn({ err: e }, 'Not found');
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
  if (e instanceof ConflictError) {
    logger.warn({ err: e }, 'Conflict');
    return NextResponse.json({ error: e.message }, { status: 409 });
  }
  if (e instanceof UnprocessableError) {
    logger.warn({ err: e }, 'Unprocessable entity');
    return NextResponse.json({ error: e.message }, { status: 422 });
  }
  if (e instanceof ServiceRegistryError) {
    const status = e.name === 'ServiceInstanceNotFoundError' ? 404 : 500;
    logger.error({ err: e, status }, 'Service registry error');
    return NextResponse.json({ error: e.message }, { status });
  }
  if (e instanceof ServiceError) {
    logger.error({ err: e, code: e.code, status: e.statusCode }, 'Service error');
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }
  if (isDatabaseError(e)) {
    // Database errors carry ORM internals (engine text, table and column names) in
    // their message; log the detail, return only a generic body. Unlike the final
    // fallback below, this branch never echoes error text. The distinct log message
    // is the signal that a repository is missing a mapping.
    logger.error({ err: e }, 'Unhandled database error');
    return NextResponse.json({ error: 'An unexpected error has occurred.' }, { status: 500 });
  }
  logger.error({ err: e }, 'Unexpected error');
  return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
}
