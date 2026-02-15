import type { LoggerService } from '../logging/types.js';

/**
 * Base class for all service adapters.
 *
 * Enforces that every adapter receives a {@link LoggerService} at
 * construction time. Subclasses access the logger via `this.logger`.
 */
export abstract class BaseServiceAdapter {
  protected readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }
}
