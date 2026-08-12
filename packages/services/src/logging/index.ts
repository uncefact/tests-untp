export type { LoggerService, LogContext, LoggerConfig, LogLevel } from './types.js';
export { createLogger } from './factory.js';
export { getRequestContext, updateRequestContext, runWithRequestContext } from './request-context.js';
export { registerRequestContextProvider } from './adapters/pino-logger.js';
export {
  CORRELATION_ID_HEADER,
  amznTraceRootToken,
  getOrMintCorrelationId,
  isValidCorrelationId,
} from './correlation-id.js';

// Auto-register the request context provider so that ALL loggers include
// request-scoped fields (correlationId, userId, tenantId, etc.) in every
// log entry once this module is loaded.
import { getRequestContext } from './request-context.js';
import { registerRequestContextProvider } from './adapters/pino-logger.js';
registerRequestContextProvider(getRequestContext);
