export interface LogContext {
  [key: string]: unknown;
}

export interface LoggerService {
  debug(msg: string): void;
  debug(obj: LogContext, msg?: string): void;

  info(msg: string): void;
  info(obj: LogContext, msg?: string): void;

  warn(msg: string): void;
  warn(obj: LogContext, msg?: string): void;

  error(msg: string): void;
  error(obj: LogContext, msg?: string): void;

  child(bindings: LogContext): LoggerService;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  level?: LogLevel;
  pretty?: boolean;
  correlationId?: string;
  /** Additional redaction paths merged with the built-in sensitive-field defaults. */
  redactPaths?: string[];
  /** Custom log sink; defaults to stdout. Disables the pretty transport when set. */
  destination?: { write: (msg: string) => void };
}
