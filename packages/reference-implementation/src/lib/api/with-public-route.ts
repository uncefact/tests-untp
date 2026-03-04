import { handleRouteError } from '@/lib/api/handle-route-error';
import { apiLogger } from '@/lib/api/logger';
import { runWithRequestContext } from '@uncefact/untp-ri-services/logging';

type PublicRouteHandler = (req: Request) => Promise<Response>;

const logger = apiLogger.child({ handler: 'public-route' });

export function withPublicRoute(handler: PublicRouteHandler) {
  return async (req: Request) => {
    const raw = req.headers.get('x-correlation-id');
    const correlationId = raw && raw.length <= 128 ? raw : crypto.randomUUID();

    return runWithRequestContext(correlationId, async () => {
      const method = req.method;
      const url = new URL(req.url);
      const path = url.pathname;
      const start = Date.now();

      logger.info({ method, path }, 'Request received');

      try {
        const response = await handler(req);
        logger.info({ method, path, status: response.status, durationMs: Date.now() - start }, 'Request completed');
        return response;
      } catch (e: unknown) {
        const errorResponse = handleRouteError(e);
        const logLevel = errorResponse.status >= 500 ? 'error' : 'warn';
        logger[logLevel](
          { method, path, status: errorResponse.status, durationMs: Date.now() - start },
          'Request completed with error',
        );
        return errorResponse;
      }
    });
  };
}
