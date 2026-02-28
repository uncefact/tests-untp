import { createLogger } from '../factory.js';
import { getRequestContext, runWithRequestContext, updateRequestContext } from '../request-context.js';
import { registerRequestContextProvider } from '../adapters/pino-logger.js';

// Trigger the barrel's side-effect: auto-registers getRequestContext as the
// request context provider for all pino loggers.  We import from the barrel to
// prove the wiring works end-to-end, then re-register with a spy wrapper so
// we can assert that the provider is actually invoked during logging.
import '../index.js';

const providerSpy = jest.fn(getRequestContext);
registerRequestContextProvider(providerSpy);

describe('Logging integration - request context auto-propagation', () => {
  beforeEach(() => {
    providerSpy.mockClear();
  });

  afterEach(() => {
    // Re-register the spy so subsequent tests still track calls.
    registerRequestContextProvider(providerSpy);
  });

  // ---------------------------------------------------------------
  // 1. Auto-registration on import
  // ---------------------------------------------------------------
  describe('auto-registration on barrel import', () => {
    it('should call the registered provider when logging inside a request context', () => {
      const logger = createLogger({ level: 'info' });

      runWithRequestContext('auto-reg-001', () => {
        logger.info('verifying auto-registration');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContainEqual({ correlationId: 'auto-reg-001' });
    });

    it('should make getRequestContext return the active context inside runWithRequestContext', () => {
      runWithRequestContext('auto-reg-002', () => {
        expect(getRequestContext()).toEqual({ correlationId: 'auto-reg-002' });
      });
    });
  });

  // ---------------------------------------------------------------
  // 2. Module-scoped logger picks up request-scoped context
  // ---------------------------------------------------------------
  describe('module-scoped logger picks up request-scoped context', () => {
    // The logger is created OUTSIDE the request context, simulating a
    // module-level singleton.  Because pino's mixin runs on every log call
    // (not at construction time), it should still resolve the request-scoped
    // context when used inside runWithRequestContext.
    const moduleScopedLogger = createLogger({ level: 'info' });

    it('should invoke the provider with the correct context when logging from a module-scoped logger', () => {
      runWithRequestContext('req-scope-42', () => {
        moduleScopedLogger.info('message from module-scoped logger');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContainEqual({ correlationId: 'req-scope-42' });
    });

    it('should pick up different contexts across successive requests', () => {
      runWithRequestContext('first-request', () => {
        moduleScopedLogger.info('first');
      });

      const firstResults = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(firstResults).toContainEqual({ correlationId: 'first-request' });

      providerSpy.mockClear();

      runWithRequestContext('second-request', () => {
        moduleScopedLogger.info('second');
      });

      const secondResults = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(secondResults).toContainEqual({ correlationId: 'second-request' });
      expect(secondResults).not.toContainEqual({ correlationId: 'first-request' });
    });
  });

  // ---------------------------------------------------------------
  // 3. Child loggers also inherit the mixin
  // ---------------------------------------------------------------
  describe('child loggers inherit the mixin', () => {
    it('should invoke the provider when a child logger logs inside a request context', () => {
      const parentLogger = createLogger({ level: 'info' });
      const childLogger = parentLogger.child({ service: 'integration-test' });

      runWithRequestContext('child-ctx-99', () => {
        childLogger.info('child log entry');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContainEqual({ correlationId: 'child-ctx-99' });
    });

    it('should invoke the provider for deeply-nested child loggers', () => {
      const root = createLogger({ level: 'info' });
      const child = root.child({ layer: 'service' });
      const grandchild = child.child({ module: 'handler' });

      runWithRequestContext('deep-child-7', () => {
        grandchild.info('deep child log');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContainEqual({ correlationId: 'deep-child-7' });
    });
  });

  // ---------------------------------------------------------------
  // 4. No context outside a request context
  // ---------------------------------------------------------------
  describe('no context outside a request context', () => {
    it('should have the provider return undefined when logging outside runWithRequestContext', () => {
      const logger = createLogger({ level: 'info' });

      logger.info('outside any context');

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues.every((v) => v === undefined)).toBe(true);
    });

    it('should have the provider return undefined after a context has ended', () => {
      const logger = createLogger({ level: 'info' });

      runWithRequestContext('temporary-id', () => {
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
    it('should resolve distinct contexts in parallel async contexts', async () => {
      const logger = createLogger({ level: 'info' });
      const capturedContexts: Record<string, (Record<string, unknown> | undefined)[]> = {
        alpha: [],
        beta: [],
      };

      const alpha = runWithRequestContext('alpha-id', async () => {
        logger.info('alpha start');
        capturedContexts.alpha.push(getRequestContext());

        await new Promise((resolve) => setTimeout(resolve, 30));

        logger.info('alpha end');
        capturedContexts.alpha.push(getRequestContext());
      });

      const beta = runWithRequestContext('beta-id', async () => {
        logger.info('beta start');
        capturedContexts.beta.push(getRequestContext());

        await new Promise((resolve) => setTimeout(resolve, 10));

        logger.info('beta end');
        capturedContexts.beta.push(getRequestContext());
      });

      await Promise.all([alpha, beta]);

      expect(capturedContexts.alpha).toEqual([{ correlationId: 'alpha-id' }, { correlationId: 'alpha-id' }]);
      expect(capturedContexts.beta).toEqual([{ correlationId: 'beta-id' }, { correlationId: 'beta-id' }]);
    });

    it('should call the provider with the correct context for each concurrent context', async () => {
      const logger = createLogger({ level: 'info' });

      const task1 = runWithRequestContext('concurrent-1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        logger.info('task 1');
      });

      const task2 = runWithRequestContext('concurrent-2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.info('task 2');
      });

      await Promise.all([task1, task2]);

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContainEqual({ correlationId: 'concurrent-1' });
      expect(returnValues).toContainEqual({ correlationId: 'concurrent-2' });
    });
  });

  // ---------------------------------------------------------------
  // 6. Extension fields (userId, tenantId) appear in context
  // ---------------------------------------------------------------
  describe('extension fields in request context', () => {
    it('should include extension fields after updateRequestContext is called', () => {
      const logger = createLogger({ level: 'info' });

      runWithRequestContext('ext-001', () => {
        updateRequestContext({ userId: 'user-abc' });
        updateRequestContext({ tenantId: 'tenant-xyz' });

        logger.info('log with extension fields');
      });

      expect(providerSpy).toHaveBeenCalled();

      const returnValues = providerSpy.mock.results.filter((r) => r.type === 'return').map((r) => r.value);
      expect(returnValues).toContainEqual({
        correlationId: 'ext-001',
        userId: 'user-abc',
        tenantId: 'tenant-xyz',
      });
    });

    it('should include only correlationId before extension fields are set', () => {
      runWithRequestContext('ext-002', () => {
        // Before any updateRequestContext calls
        const ctx = getRequestContext();
        expect(ctx).toEqual({ correlationId: 'ext-002' });
        expect(ctx).not.toHaveProperty('userId');
        expect(ctx).not.toHaveProperty('tenantId');
      });
    });

    it('should progressively add extension fields to the provider return value', () => {
      runWithRequestContext('ext-003', () => {
        expect(getRequestContext()).toEqual({ correlationId: 'ext-003' });

        updateRequestContext({ userId: 'user-progressive' });
        expect(getRequestContext()).toEqual({
          correlationId: 'ext-003',
          userId: 'user-progressive',
        });

        updateRequestContext({ tenantId: 'tenant-progressive' });
        expect(getRequestContext()).toEqual({
          correlationId: 'ext-003',
          userId: 'user-progressive',
          tenantId: 'tenant-progressive',
        });
      });
    });

    it('should keep extension fields isolated across concurrent contexts', async () => {
      const capturedContexts: Record<string, Record<string, unknown> | undefined> = {};

      const task1 = runWithRequestContext('iso-1', async () => {
        updateRequestContext({ userId: 'user-1', tenantId: 'tenant-1' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        capturedContexts['task1'] = getRequestContext();
      });

      const task2 = runWithRequestContext('iso-2', async () => {
        updateRequestContext({ userId: 'user-2' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        capturedContexts['task2'] = getRequestContext();
      });

      await Promise.all([task1, task2]);

      expect(capturedContexts['task1']).toEqual({
        correlationId: 'iso-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      expect(capturedContexts['task2']).toEqual({
        correlationId: 'iso-2',
        userId: 'user-2',
      });
    });
  });
});
