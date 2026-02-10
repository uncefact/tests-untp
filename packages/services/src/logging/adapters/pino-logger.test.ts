import pino from 'pino';
import { PinoLoggerAdapter } from './pino-logger.js';

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
});
