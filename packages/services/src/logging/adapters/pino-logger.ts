import pino from 'pino';
import type { LoggerService, LogContext, LoggerConfig } from '../types.js';

type CorrelationIdProvider = () => string | undefined;
let _correlationIdProvider: CorrelationIdProvider | undefined;

/**
 * Register a function that provides the current correlation ID.
 * Called automatically when `@uncefact/untp-ri-services/logging` is imported.
 * The provider is invoked on every log call via pino's mixin, so loggers
 * created at module scope still pick up request-scoped correlation IDs.
 */
export function registerCorrelationIdProvider(fn: CorrelationIdProvider): void {
  _correlationIdProvider = fn;
}

export class PinoLoggerAdapter implements LoggerService {
  private logger: pino.Logger;

  constructor(configOrLogger?: LoggerConfig | pino.Logger) {
    if (configOrLogger && typeof configOrLogger === 'object' && 'child' in configOrLogger) {
      this.logger = configOrLogger;
    } else {
      const config = configOrLogger || {};
      this.logger = pino({
        level: config.level || process.env.LOG_LEVEL || 'info',
        mixin() {
          if (_correlationIdProvider) {
            const correlationId = _correlationIdProvider();
            return correlationId ? { correlationId } : {};
          }
          return {};
        },
        ...(config.pretty && {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }),
        ...(config.correlationId && {
          base: {
            correlationId: config.correlationId,
          },
        }),
      });
    }
  }

  debug(msgOrObj: string | LogContext, msg?: string): void {
    if (typeof msgOrObj === 'string') {
      this.logger.debug(msgOrObj);
    } else {
      this.logger.debug(msgOrObj, msg);
    }
  }

  info(msgOrObj: string | LogContext, msg?: string): void {
    if (typeof msgOrObj === 'string') {
      this.logger.info(msgOrObj);
    } else {
      this.logger.info(msgOrObj, msg);
    }
  }

  warn(msgOrObj: string | LogContext, msg?: string): void {
    if (typeof msgOrObj === 'string') {
      this.logger.warn(msgOrObj);
    } else {
      this.logger.warn(msgOrObj, msg);
    }
  }

  error(msgOrObj: string | LogContext, msg?: string): void {
    if (typeof msgOrObj === 'string') {
      this.logger.error(msgOrObj);
    } else {
      this.logger.error(msgOrObj, msg);
    }
  }

  child(bindings: LogContext): LoggerService {
    const childLogger = this.logger.child(bindings);
    return new PinoLoggerAdapter(childLogger);
  }
}
