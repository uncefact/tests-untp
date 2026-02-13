export type { LoggerService, LogContext, LoggerConfig, LogLevel } from './types.js';
export { createLogger } from './factory.js';
export { getCorrelationId, setCorrelationId, runWithCorrelationId } from './correlation-context.js';
export { registerCorrelationIdProvider } from './adapters/pino-logger.js';

// Auto-register the correlation ID provider so that ALL loggers (even those
// created at module scope via the main barrel) include the request-scoped
// correlation ID in every log entry once this module is loaded.
import { getCorrelationId } from './correlation-context.js';
import { registerCorrelationIdProvider } from './adapters/pino-logger.js';
registerCorrelationIdProvider(getCorrelationId);
