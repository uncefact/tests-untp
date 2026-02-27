import { getRequestContext, updateRequestContext, runWithRequestContext } from './request-context.js';

describe('getRequestContext', () => {
  it('should return undefined outside any context', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('should return context with correlationId inside runWithRequestContext', () => {
    runWithRequestContext('abc-123', () => {
      expect(getRequestContext()).toEqual({ correlationId: 'abc-123' });
    });
  });

  it('should return undefined after the callback completes', () => {
    runWithRequestContext('abc-123', () => {
      // inside: context is set
    });

    expect(getRequestContext()).toBeUndefined();
  });
});

describe('updateRequestContext', () => {
  it('should be a no-op outside any context and not throw', () => {
    expect(() => updateRequestContext({ userId: 'orphan-user' })).not.toThrow();
    expect(getRequestContext()).toBeUndefined();
  });

  it('should merge fields into the active context', () => {
    runWithRequestContext('ctx-001', () => {
      expect(getRequestContext()).toEqual({ correlationId: 'ctx-001' });

      updateRequestContext({ userId: 'user-42' });

      expect(getRequestContext()).toEqual({
        correlationId: 'ctx-001',
        userId: 'user-42',
      });
    });
  });

  it('should progressively merge multiple fields', () => {
    runWithRequestContext('ctx-002', () => {
      updateRequestContext({ userId: 'user-1' });
      updateRequestContext({ tenantId: 'tenant-1' });

      expect(getRequestContext()).toEqual({
        correlationId: 'ctx-002',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
    });
  });

  it('should overwrite existing fields when updated', () => {
    runWithRequestContext('ctx-003', () => {
      updateRequestContext({ userId: 'first' });
      updateRequestContext({ userId: 'second' });

      expect(getRequestContext()).toEqual({
        correlationId: 'ctx-003',
        userId: 'second',
      });
    });
  });
});

describe('runWithRequestContext', () => {
  it('should set the correlationId for the duration of the callback', () => {
    const captured: (Record<string, unknown> | undefined)[] = [];

    captured.push(getRequestContext());

    runWithRequestContext('during', () => {
      captured.push(getRequestContext());
    });

    captured.push(getRequestContext());

    expect(captured).toEqual([undefined, { correlationId: 'during' }, undefined]);
  });

  it('should return the callback return value', () => {
    const result = runWithRequestContext('id-1', () => {
      return 42;
    });

    expect(result).toBe(42);
  });

  it('should support async callbacks', async () => {
    const result = await runWithRequestContext('async-id', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return getRequestContext();
    });

    expect(result).toEqual({ correlationId: 'async-id' });
  });

  it('should support nested calls where inner overrides outer and outer is restored after', () => {
    runWithRequestContext('outer', () => {
      expect(getRequestContext()).toEqual({ correlationId: 'outer' });

      runWithRequestContext('inner', () => {
        expect(getRequestContext()).toEqual({ correlationId: 'inner' });
      });

      expect(getRequestContext()).toEqual({ correlationId: 'outer' });
    });
  });

  it('should not leak inner context updates to outer context', () => {
    runWithRequestContext('outer', () => {
      updateRequestContext({ userId: 'outer-user' });

      runWithRequestContext('inner', () => {
        updateRequestContext({ userId: 'inner-user', tenantId: 'inner-tenant' });
        expect(getRequestContext()).toEqual({
          correlationId: 'inner',
          userId: 'inner-user',
          tenantId: 'inner-tenant',
        });
      });

      // Outer context should be unchanged by inner updates
      expect(getRequestContext()).toEqual({
        correlationId: 'outer',
        userId: 'outer-user',
      });
    });
  });

  it('should isolate contexts across concurrent async operations', async () => {
    const results: Record<string, Record<string, unknown> | undefined> = {};

    const task1 = runWithRequestContext('task-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      results['task1'] = getRequestContext();
    });

    const task2 = runWithRequestContext('task-2', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      results['task2'] = getRequestContext();
    });

    const task3 = runWithRequestContext('task-3', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      results['task3'] = getRequestContext();
    });

    await Promise.all([task1, task2, task3]);

    expect(results['task1']).toEqual({ correlationId: 'task-1' });
    expect(results['task2']).toEqual({ correlationId: 'task-2' });
    expect(results['task3']).toEqual({ correlationId: 'task-3' });
  });

  it('should isolate updateRequestContext across concurrent async operations', async () => {
    const results: Record<string, Record<string, unknown> | undefined> = {};

    const task1 = runWithRequestContext('task-a', async () => {
      updateRequestContext({ userId: 'user-a' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      results['taskA'] = getRequestContext();
    });

    const task2 = runWithRequestContext('task-b', async () => {
      updateRequestContext({ userId: 'user-b', tenantId: 'tenant-b' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      results['taskB'] = getRequestContext();
    });

    await Promise.all([task1, task2]);

    expect(results['taskA']).toEqual({ correlationId: 'task-a', userId: 'user-a' });
    expect(results['taskB']).toEqual({
      correlationId: 'task-b',
      userId: 'user-b',
      tenantId: 'tenant-b',
    });
  });
});

describe('generic type parameter', () => {
  interface RiRequestContext extends Record<string, unknown> {
    userId: string;
    tenantId: string;
  }

  it('should allow typed access via generic parameter on getRequestContext', () => {
    runWithRequestContext('typed-ctx', () => {
      updateRequestContext<RiRequestContext>({ userId: 'user-typed', tenantId: 'tenant-typed' });

      const ctx = getRequestContext<RiRequestContext>();
      expect(ctx).toBeDefined();
      expect(ctx!.correlationId).toBe('typed-ctx');
      expect(ctx!.userId).toBe('user-typed');
      expect(ctx!.tenantId).toBe('tenant-typed');
    });
  });

  it('should allow partial updates via generic parameter on updateRequestContext', () => {
    runWithRequestContext('partial-ctx', () => {
      // Only setting userId first (partial of RiRequestContext)
      updateRequestContext<RiRequestContext>({ userId: 'user-only' });

      const ctx = getRequestContext<RiRequestContext>();
      expect(ctx).toBeDefined();
      expect(ctx!.correlationId).toBe('partial-ctx');
      expect(ctx!.userId).toBe('user-only');
    });
  });
});
