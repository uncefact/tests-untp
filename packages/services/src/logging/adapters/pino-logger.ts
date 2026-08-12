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
 * Secret-bearing field names redacted by default. `decryptionKey` protects
 * stored credential keys, `apiKey` covers every service adapter's declared
 * sensitive config field, and `authorization` / `Authorization` cover request
 * header objects (constructed adapter headers capitalise the key; the Headers
 * class normalises it to lower case). `token` and `password` cover generic
 * credential shapes.
 */
const DEFAULT_REDACT_FIELDS = ['decryptionKey', 'apiKey', 'authorization', 'Authorization', 'token', 'password'];

/**
 * Sensitive paths redacted in every log entry: each default field at the top
 * level, one level deep, and two levels deep (the `*[*]` subscript wildcard
 * matches arrays and plain objects alike, covering shapes such as
 * `{ credentials: [{ decryptionKey }] }`). Pino wildcards match a single
 * level each, so apart from the HTTP-client error exception below, values
 * nested three or more levels deep are not redacted; do not log
 * secret-bearing objects inside wrappers.
 */
const DEFAULT_REDACT_PATHS = [
  ...DEFAULT_REDACT_FIELDS.flatMap((field) => [field, `*.${field}`, `*[*].${field}`]),
  // The canonical HTTP-client error shape, `{ error: { config: { headers:
  // { Authorization } } } }`, sits one level deeper than the wildcard
  // defaults reach, so it gets its own narrow pair.
  '*.config.headers.Authorization',
  '*.config.headers.authorization',
];

/**
 * Deployment-supplied redaction paths from the LOG_REDACT_PATHS environment
 * variable: comma-separated pino redact paths merged with the defaults, so an
 * operator can cover a secret shape specific to their environment without a
 * code change. Read at logger construction; an invalid path fails
 * construction (see the constructor).
 */
function redactPathsFromEnv(): string[] {
  const raw = process.env.LOG_REDACT_PATHS;
  if (!raw) return [];
  const segments = raw.split(',').map((path) => path.trim());
  const paths = segments.filter((path) => path.length > 0);
  if (paths.length < segments.length) {
    // The logger does not exist yet, so console is the only outlet.
    console.warn(`LOG_REDACT_PATHS contained ${segments.length - paths.length} empty segment(s); they were ignored.`);
  }
  return paths;
}

export class PinoLoggerAdapter implements LoggerService {
  private logger: pino.Logger;

  constructor(configOrLogger?: LoggerConfig | pino.Logger) {
    if (configOrLogger && typeof configOrLogger === 'object' && 'child' in configOrLogger) {
      this.logger = configOrLogger;
    } else {
      const config = configOrLogger || {};
      const envRedactPaths = redactPathsFromEnv();
      try {
        this.logger = this.buildPinoLogger(config, envRedactPaths);
      } catch (error) {
        // pino rejects a malformed redact path synchronously with
        // "Invalid redaction path (<path>)". Failing here fails process
        // boot, which is deliberate: a dropped redaction path is a silent
        // secret leak. The wrapper names LOG_REDACT_PATHS only when the
        // offending path came from it; every other construction failure
        // propagates untouched so its message points at the actual cause.
        const offendingPath =
          error instanceof Error ? /^Invalid redaction path \((.*)\)/.exec(error.message)?.[1] : undefined;
        if (offendingPath === undefined || !envRedactPaths.includes(offendingPath)) throw error;
        throw new Error(
          `Logger construction failed: ${(error as Error).message}. ` +
            `Check the LOG_REDACT_PATHS environment variable (currently: ${envRedactPaths.join(', ')}) ` +
            'for an invalid pino redact path.',
          { cause: error },
        );
      }
    }
  }

  private buildPinoLogger(config: LoggerConfig, envRedactPaths: string[]): pino.Logger {
    return pino(
      {
        level: config.level || process.env.LOG_LEVEL || 'info',
        redact: {
          paths: [...DEFAULT_REDACT_PATHS, ...envRedactPaths, ...(config.redactPaths ?? [])],
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
