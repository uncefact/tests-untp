import { NextResponse } from 'next/server';
import { getRequestContext } from '@uncefact/untp-ri-services/logging';
import { unexpectedErrorMessage } from '@/lib/api/errors';
import { safeError } from '@/lib/api/safe-error';

export type SanitisedServerErrorLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
};

/**
 * Logs a safe error detail and returns a generic 500 with the request
 * correlation id. Use this for failures whose internal message must not be
 * returned by the route error mapper's fallback.
 */
export function sanitisedServerError(error: Error, logger: SanitisedServerErrorLogger, detail: string): Response {
  logger.error({ error: safeError(error) }, detail);
  return NextResponse.json({ error: unexpectedErrorMessage(getRequestContext()?.correlationId) }, { status: 500 });
}
