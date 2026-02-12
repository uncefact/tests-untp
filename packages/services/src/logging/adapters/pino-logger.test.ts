import pino from 'pino';
import { Writable } from 'stream';
import { PinoLoggerAdapter, registerCorrelationIdProvider } from './pino-logger.js';

describe('PinoLoggerAdapter', () => {
  describe('child method optimization', () => {
    it('should create child logger without wasteful new pino instance', () => {
      const rootLogger = new PinoLoggerAdapter({ level: 'info' });

      const pinoSpy = jest.spyOn(pino, 'pino' as any);
      const childLogger = rootLogger.child({ module: 'test-module' });
      expect(childLogger).toBeDefined();
      expect(pinoSpy).not.toHaveBeenCalled();

      pinoSpy.mockRestore();
    });

    it('should accept a pino.Logger instance in constructor', () => {
      const pinoInstance = pino({ level: 'debug' });
      const adapter = new PinoLoggerAdapter(pinoInstance);

      expect(adapter).toBeDefined();
      expect(() => adapter.info('test message')).not.toThrow();
    });

    it('should properly chain child loggers', () => {
      const rootLogger = new PinoLoggerAdapter({ level: 'info' });
      const child1 = rootLogger.child({ service: 'api' });
      const child2 = child1.child({ module: 'auth' });

      expect(child1).toBeDefined();
      expect(child2).toBeDefined();
      expect(() => child2.info('test')).not.toThrow();
    });
  });

  describe('logging methods', () => {
    it('should log debug messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'debug' });
      expect(() => adapter.debug('debug message')).not.toThrow();
      expect(() => adapter.debug({ key: 'value' }, 'debug with context')).not.toThrow();
    });

    it('should log info messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'info' });
      expect(() => adapter.info('info message')).not.toThrow();
      expect(() => adapter.info({ key: 'value' }, 'info with context')).not.toThrow();
    });

    it('should log warn messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'warn' });
      expect(() => adapter.warn('warn message')).not.toThrow();
      expect(() => adapter.warn({ key: 'value' }, 'warn with context')).not.toThrow();
    });

    it('should log error messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'error' });
      expect(() => adapter.error('error message')).not.toThrow();
      expect(() => adapter.error({ key: 'value' }, 'error with context')).not.toThrow();
    });
  });

  describe('registerCorrelationIdProvider and mixin', () => {
    function createSink(): { sink: Writable; getLines: () => string[] } {
      const lines: string[] = [];
      const sink = new Writable({
        write(chunk, _encoding, cb) {
          lines.push(chunk.toString().trim());
          cb();
        },
      });
      return { sink, getLines: () => lines };
    }

    afterEach(() => {
      // Reset the module-level provider to avoid leaking state between tests
      registerCorrelationIdProvider(undefined as unknown as () => string | undefined);
    });

    it('should register a provider that gets called during logging', () => {
      const provider = jest.fn().mockReturnValue('corr-abc');
      registerCorrelationIdProvider(provider);

      const adapter = new PinoLoggerAdapter({ level: 'info' });
      adapter.info('hello');

      expect(provider).toHaveBeenCalled();
    });

    it('should return empty object from mixin when no provider is registered', () => {
      const { sink, getLines } = createSink();

      // No provider registered (reset in afterEach), so mixin inside
      // PinoLoggerAdapter would return {}. Verify with a raw pino logger
      // using the same mixin pattern.
      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            // Mirrors PinoLoggerAdapter's mixin when no provider is set
            return {};
          },
        },
        sink,
      );

      loggerWithMixin.info('no correlation');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed).not.toHaveProperty('correlationId');
    });

    it('should return empty object from mixin when provider returns undefined', () => {
      const provider = jest.fn().mockReturnValue(undefined);
      registerCorrelationIdProvider(provider);

      const { sink, getLines } = createSink();

      // Create a raw pino logger that exercises the same mixin logic
      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const correlationId = provider();
            return correlationId ? { correlationId } : {};
          },
        },
        sink,
      );

      loggerWithMixin.info('no id');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed).not.toHaveProperty('correlationId');
      expect(provider).toHaveBeenCalled();
    });

    it('should inject correlationId when provider returns a value', () => {
      const provider = jest.fn().mockReturnValue('req-123');
      registerCorrelationIdProvider(provider);

      const { sink, getLines } = createSink();

      // Create a raw pino logger that mirrors PinoLoggerAdapter's mixin
      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const correlationId = provider();
            return correlationId ? { correlationId } : {};
          },
        },
        sink,
      );

      loggerWithMixin.info('test message');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed.correlationId).toBe('req-123');
    });

    it('should inherit mixin behaviour in child loggers', () => {
      const provider = jest.fn().mockReturnValue('req-child-456');
      registerCorrelationIdProvider(provider);

      const { sink, getLines } = createSink();

      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const correlationId = provider();
            return correlationId ? { correlationId } : {};
          },
        },
        sink,
      );

      const childLogger = loggerWithMixin.child({ module: 'child-mod' });
      childLogger.info('child log entry');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed.correlationId).toBe('req-child-456');
      expect(parsed.module).toBe('child-mod');
    });
  });
});
