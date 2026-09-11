import { createLogger } from '@uncefact/untp-ri-services/logging';
import { getActiveTraceContext } from '@/lib/observability/trace-context';

const traceContextProvider = getActiveTraceContext;

export const appLogger = createLogger({ traceContextProvider });

/**
 * Singleton API logger shared across all route handlers.
 *
 * Routes should use `.child({ route: 'xxx' })` to add route-level context,
 * NOT create their own logger via `createLogger()`.
 */
export const apiLogger = appLogger.child({ module: 'api' });
