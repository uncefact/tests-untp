import { CredentialStatusError } from '@/lib/credentials/credential-status-error';
import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
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
import { mapRouteError } from './route-error-mapping';

const logger = apiLogger.child({ handler: 'error' });

/**
 * Logs the failure at the level appropriate to its typed or database class,
 * then delegates response status and fields to the shared route-error mapper.
 * Unmapped errors receive the generic 500 response, with pipeline callers
 * optionally receiving the redacted message.
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
  if (e instanceof CredentialStatusError) {
    logger.error({ err: e, code: e.code, status: e.statusCode }, 'Credential status operation failed');
  } else if (e instanceof RequestBodyUnreadableError) {
    // A body that could not be read is a bad request, the same 400 it was
    // before the reader had its own error type. Routes that read bytes
    // themselves (credential issuance, for its digest) reach this directly
    // rather than through parseRequestBody.
    logger.warn({ err: e }, 'Request body could not be read');
  } else if (e instanceof ValidationError) {
    // The default err serialiser concatenates the messages and stacks of the
    // native cause chain (not the causes' typed fields), so a ValidationError
    // constructed with a cause logs the underlying failure's text here.
    logger.warn({ err: e }, 'Validation error');
  } else if (e instanceof ForbiddenError) {
    logger.warn({ err: e }, 'Forbidden');
  } else if (e instanceof NotFoundError) {
    logger.warn({ err: e }, 'Not found');
  } else if (e instanceof ConflictError) {
    logger.warn({ err: e }, 'Conflict');
  } else if (e instanceof PayloadTooLargeError) {
    logger.warn({ err: e }, 'Payload too large');
  } else if (e instanceof UnprocessableError) {
    logger.warn({ err: e }, 'Unprocessable entity');
  } else if (e instanceof ServiceError) {
    logger.error({ err: e, code: e.code, status: e.statusCode }, 'Service error');
  } else if (e instanceof ServiceRegistryError) {
    logger.error({ err: e }, 'Service registry error');
  } else if (isDatabaseError(e)) {
    // Database errors carry ORM internals (engine text, table and column names) in
    // their message; log the detail, return only a generic body. Unlike the final
    // fallback below, this branch never echoes error text. A repository may attach
    // context to an error so the shared detector retains the operation details.
    const context =
      typeof e === 'object' && e !== null && 'context' in e ? (e as { context?: unknown }).context : undefined;
    logger.error(context === undefined ? { err: e } : { err: e, context }, 'Unhandled database error');
  } else {
    logger.error({ err: e }, 'Unexpected error');
  }

  if (e instanceof CredentialStatusError) {
    return NextResponse.json(
      { error: e.message, code: e.code, ...(e.observed ? { observed: e.observed } : {}) },
      { status: e.statusCode },
    );
  }

  const mapped = mapRouteError(e);
  if (mapped !== undefined) {
    const body = mapped.code === undefined ? { error: mapped.message } : { error: mapped.message, code: mapped.code };
    return NextResponse.json(body, { status: mapped.status });
  }
  return NextResponse.json(
    { error: options.redactUnmapped ? unexpectedErrorMessage(getRequestContext()?.correlationId) : errorMessage(e) },
    { status: 500 },
  );
}
