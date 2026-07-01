import pino from 'pino';
import type { LoggerService, LogContext, LoggerConfig } from '../types.js';

type RequestContextProvider = () => Record<string, unknown> | undefined;
let _requestContextProvider: RequestContextProvider | undefined;

/**
 * Register a function that provides the current request context.
 * Called automatically when `@uncefact/untp-ri-services/logging` is imported.
 * The provider is invoked on every log call via pino's mixin, so loggers
 * created at module scope still pick up request-scoped context fields.
 */
export function registerRequestContextProvider(fn: RequestContextProvider): void {
  _requestContextProvider = fn;
}

/**
 * Sensitive paths redacted in every log entry: decryptionKey at the top
 * level, one level deep, and two levels deep (the `*[*]` subscript wildcard
 * matches arrays and plain objects alike, covering shapes such as
 * `{ credentials: [{ decryptionKey }] }`). Pino wildcards match a single
 * level each, so values nested three or more levels deep are not redacted;
 * do not log secret-bearing objects inside wrappers.
 */
const DEFAULT_REDACT_PATHS = ['decryptionKey', '*.decryptionKey', '*[*].decryptionKey'];

export class PinoLoggerAdapter implements LoggerService {
  private logger: pino.Logger;

  constructor(configOrLogger?: LoggerConfig | pino.Logger) {
    if (configOrLogger && typeof configOrLogger === 'object' && 'child' in configOrLogger) {
      this.logger = configOrLogger;
    } else {
      const config = configOrLogger || {};
      this.logger = pino(
        {
          level: config.level || process.env.LOG_LEVEL || 'info',
          redact: {
            paths: [...DEFAULT_REDACT_PATHS, ...(config.redactPaths ?? [])],
            censor: '[REDACTED]',
          },
          mixin() {
            if (_requestContextProvider) {
              try {
                const context = _requestContextProvider();
                return context ? { ...context } : {};
              } catch (e) {
                console.error('Failed to get request context for logging:', e);
                return {};
              }
            }
            return {};
          },
          ...(config.pretty &&
            !config.destination && {
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
        },
        config.destination,
      );
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
