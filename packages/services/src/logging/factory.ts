import type { LoggerService, LoggerConfig } from './types.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.js';

export function createLogger(config: LoggerConfig = {}): LoggerService {
  return new PinoLoggerAdapter(config);
}
