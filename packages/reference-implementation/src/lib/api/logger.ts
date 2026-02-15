import { createLogger } from '@uncefact/untp-ri-services/logging';

/**
 * Singleton API logger shared across all route handlers.
 *
 * Routes should use `.child({ route: 'xxx' })` to add route-level context,
 * NOT create their own logger via `createLogger()`.
 */
export const apiLogger = createLogger().child({ module: 'api' });
