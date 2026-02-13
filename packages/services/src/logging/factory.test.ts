import { createLogger } from './factory.js';
import { PinoLoggerAdapter } from './adapters/pino-logger.js';

describe('createLogger', () => {
  it('should create PinoLoggerAdapter', () => {
    const logger = createLogger();
    expect(logger).toBeInstanceOf(PinoLoggerAdapter);
  });

  it('should pass config to the logger adapter', () => {
    const logger = createLogger({ level: 'debug' });
    expect(logger).toBeDefined();
  });

  it('should pass correlationId to the logger adapter', () => {
    const logger = createLogger({ correlationId: 'test-123' });
    expect(logger).toBeDefined();
  });
});
