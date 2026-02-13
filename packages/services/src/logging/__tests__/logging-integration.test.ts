import { createLogger } from '../factory.js';
import { getCorrelationId, runWithCorrelationId } from '../correlation-context.js';
import { registerCorrelationIdProvider } from '../adapters/pino-logger.js';

// Trigger the barrel's side-effect: auto-registers getCorrelationId as the
// correlation ID provider for all pino loggers.  We import from the barrel to
// prove the wiring works end-to-end, then re-register with a spy wrapper so
// we can assert that the provider is actually invoked during logging.
import '../index.js';

const providerSpy = jest.fn(getCorrelationId);
registerCorrelationIdProvider(providerSpy);

describe('Logging integration - correlation ID auto-propagation', () => {
  beforeEach(() => {
    providerSpy.mockClear();
  });

  afterEach(() => {
    // Re-register the spy so subsequent tests still track calls.
    registerCorrelationIdProvider(providerSpy);
  });

  // ---------------------------------------------------------------
  // 1. Auto-registration on import
  // ---------------------------------------------------------------
  describe('auto-registration on barrel import', () => {
    it('should call the registered provider when logging inside a correlation context', () => {
      const logger = createLogger({ level: 'info' });

      runWithCorrelationId('auto-reg-001', () => {
        logger.info('verifying auto-registration');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContain('auto-reg-001');
    });

    it('should make getCorrelationId return the active ID inside runWithCorrelationId', () => {
      runWithCorrelationId('auto-reg-002', () => {
        expect(getCorrelationId()).toBe('auto-reg-002');
      });
    });
  });

  // ---------------------------------------------------------------
  // 2. Module-scoped logger picks up request-scoped correlation ID
  // ---------------------------------------------------------------
  describe('module-scoped logger picks up request-scoped correlation ID', () => {
    // The logger is created OUTSIDE the correlation context, simulating a
    // module-level singleton.  Because pino's mixin runs on every log call
    // (not at construction time), it should still resolve the request-scoped
    // correlation ID when used inside runWithCorrelationId.
    const moduleScopedLogger = createLogger({ level: 'info' });

    it('should invoke the provider with the correct ID when logging from a module-scoped logger', () => {
      runWithCorrelationId('req-scope-42', () => {
        moduleScopedLogger.info('message from module-scoped logger');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContain('req-scope-42');
    });

    it('should pick up different IDs across successive requests', () => {
      runWithCorrelationId('first-request', () => {
        moduleScopedLogger.info('first');
      });

      const firstResults = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(firstResults).toContain('first-request');

      providerSpy.mockClear();

      runWithCorrelationId('second-request', () => {
        moduleScopedLogger.info('second');
      });

      const secondResults = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(secondResults).toContain('second-request');
      expect(secondResults).not.toContain('first-request');
    });
  });

  // ---------------------------------------------------------------
  // 3. Child loggers also inherit the mixin
  // ---------------------------------------------------------------
  describe('child loggers inherit the mixin', () => {
    it('should invoke the provider when a child logger logs inside a correlation context', () => {
      const parentLogger = createLogger({ level: 'info' });
      const childLogger = parentLogger.child({ service: 'integration-test' });

      runWithCorrelationId('child-ctx-99', () => {
        childLogger.info('child log entry');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContain('child-ctx-99');
    });

    it('should invoke the provider for deeply-nested child loggers', () => {
      const root = createLogger({ level: 'info' });
      const child = root.child({ layer: 'service' });
      const grandchild = child.child({ module: 'handler' });

      runWithCorrelationId('deep-child-7', () => {
        grandchild.info('deep child log');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContain('deep-child-7');
    });
  });

  // ---------------------------------------------------------------
  // 4. No correlationId outside a context
  // ---------------------------------------------------------------
  describe('no correlationId outside a context', () => {
    it('should have the provider return undefined when logging outside runWithCorrelationId', () => {
      const logger = createLogger({ level: 'info' });

      logger.info('outside any context');

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues.every((v) => v === undefined)).toBe(true);
    });

    it('should have the provider return undefined after a context has ended', () => {
      const logger = createLogger({ level: 'info' });

      runWithCorrelationId('temporary-id', () => {
        logger.info('inside context');
      });

      providerSpy.mockClear();

      logger.info('after context');

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues.every((v) => v === undefined)).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // 5. Concurrent contexts are isolated
  // ---------------------------------------------------------------
  describe('concurrent contexts are isolated', () => {
    it('should resolve distinct correlation IDs in parallel async contexts', async () => {
      const logger = createLogger({ level: 'info' });
      const capturedIds: Record<string, (string | undefined)[]> = {
        alpha: [],
        beta: [],
      };

      const alpha = runWithCorrelationId('alpha-id', async () => {
        logger.info('alpha start');
        capturedIds.alpha.push(getCorrelationId());

        await new Promise((resolve) => setTimeout(resolve, 30));

        logger.info('alpha end');
        capturedIds.alpha.push(getCorrelationId());
      });

      const beta = runWithCorrelationId('beta-id', async () => {
        logger.info('beta start');
        capturedIds.beta.push(getCorrelationId());

        await new Promise((resolve) => setTimeout(resolve, 10));

        logger.info('beta end');
        capturedIds.beta.push(getCorrelationId());
      });

      await Promise.all([alpha, beta]);

      expect(capturedIds.alpha).toEqual(['alpha-id', 'alpha-id']);
      expect(capturedIds.beta).toEqual(['beta-id', 'beta-id']);
    });

    it('should call the provider with the correct ID for each concurrent context', async () => {
      const logger = createLogger({ level: 'info' });

      const task1 = runWithCorrelationId('concurrent-1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        logger.info('task 1');
      });

      const task2 = runWithCorrelationId('concurrent-2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.info('task 2');
      });

      await Promise.all([task1, task2]);

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContain('concurrent-1');
      expect(returnValues).toContain('concurrent-2');
    });
  });
});
