import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RequestBodyUnreadableError,
  ServiceInstanceNotFoundError,
  ServiceRegistryError,
  UnprocessableError,
  unexpectedErrorMessage,
} from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { isDatabaseError } from '@/lib/prisma/db-errors';
import { ServiceError } from '@uncefact/untp-ri-services';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';

export type RouteErrorMapping = { status: number; code?: string; message: string };

/** Maps typed route failures and sanitised database failures to their API fields. */
export function mapRouteError(error: unknown): RouteErrorMapping | undefined {
  if (error instanceof RequestBodyUnreadableError) return { status: 400, message: error.message };
  if (error instanceof ValidationError) return withOptionalCode(400, error.code, error.message);
  if (error instanceof ForbiddenError) return withOptionalCode(403, error.code, error.message);
  if (error instanceof NotFoundError) return withOptionalCode(404, error.code, error.message);
  if (error instanceof ConflictError) return withOptionalCode(409, error.code, error.message);
  if (error instanceof PayloadTooLargeError) return withOptionalCode(413, error.code, error.message);
  if (error instanceof UnprocessableError) return withOptionalCode(422, error.code, error.message);
  if (error instanceof ServiceInstanceNotFoundError) {
    return { status: 404, code: 'SERVICE_INSTANCE_NOT_FOUND', message: error.message };
  }
  if (error instanceof ServiceRegistryError) {
    return { status: 500, message: error.message };
  }
  if (error instanceof ServiceError) return withOptionalCode(error.statusCode, error.code, error.message);
  if (isDatabaseError(error)) {
    return { status: 500, message: unexpectedErrorMessage(getRequestContext()?.correlationId) };
  }
  return undefined;
}

function withOptionalCode(status: number, code: string | undefined, message: string): RouteErrorMapping {
  return code === undefined ? { status, message } : { status, code, message };
}
