import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
  errorMessage,
  ServiceRegistryError,
  unexpectedErrorMessage,
} from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { ServiceError } from '@uncefact/untp-ri-services';
import { apiLogger } from '@/lib/api/logger';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';

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
type HandleRouteErrorOptions = {
  /**
   * Return the canned message instead of the thrown text when no branch
   * below claims the error. Deliberately not part of the exported surface:
   * `handlePipelineError` is the only way to ask for it, so a route caller
   * cannot redact a handler failure whose contract is to echo its message.
   */
  redactUnmapped?: boolean;
};

/**
 * Maps an error raised outside a route handler, where an unmapped message
 * must not reach the client. Typed and database errors map exactly as they
 * do for handlers; anything else becomes the canned message.
 */
export function handlePipelineError(e: unknown): Response {
  return handleRouteError(e, { redactUnmapped: true });
}

export function handleRouteError(e: unknown, options: HandleRouteErrorOptions = {}): Response {
  if (e instanceof ValidationError) {
    // The default err serialiser concatenates the messages and stacks of the
    // native cause chain (not the causes' typed fields), so a ValidationError
    // constructed with a cause logs the underlying failure's text here.
    logger.warn({ err: e }, 'Validation error');
    const body = e.code !== undefined ? { error: e.message, code: e.code } : { error: e.message };
    return NextResponse.json(body, { status: 400 });
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
    return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
  }
  logger.error({ err: e }, 'Unexpected error');
  return NextResponse.json(
    {
      error: options.redactUnmapped ? unexpectedErrorMessage(getRequestContext()?.correlationId) : errorMessage(e),
    },
    { status: 500 },
  );
}
