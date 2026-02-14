export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface AdapterConstructorOptions {
  /** Adapter name for log prefixing (e.g. "VCKIT", "PYX_IDR") */
  name: string;
  /** API version from ServiceInstance (e.g. "1.1.0") */
  version: string;
  /** Logger instance */
  logger: Logger;
}

/** Creates a prefixed logger that adds [NAME vVERSION] to all messages */
export function createPrefixedLogger(options: AdapterConstructorOptions): Logger {
  const prefix = `[${options.name} v${options.version}]`;
  return {
    info: (msg, ...args) => options.logger.info(`${prefix} ${msg}`, ...args),
    warn: (msg, ...args) => options.logger.warn(`${prefix} ${msg}`, ...args),
    error: (msg, ...args) => options.logger.error(`${prefix} ${msg}`, ...args),
    debug: (msg, ...args) => options.logger.debug(`${prefix} ${msg}`, ...args),
  };
}
