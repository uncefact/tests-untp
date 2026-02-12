import { getCorrelationId, setCorrelationId, runWithCorrelationId } from './correlation-context.js';

describe('getCorrelationId', () => {
  it('should return undefined outside any context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('should return the correct ID inside runWithCorrelationId', () => {
    runWithCorrelationId('abc-123', () => {
      expect(getCorrelationId()).toBe('abc-123');
    });
  });

  it('should return undefined after the callback completes', () => {
    runWithCorrelationId('abc-123', () => {
      // inside: ID is set
    });

    expect(getCorrelationId()).toBeUndefined();
  });
});

describe('setCorrelationId', () => {
  it('should be a no-op outside any context and not throw', () => {
    expect(() => setCorrelationId('orphan-id')).not.toThrow();
    expect(getCorrelationId()).toBeUndefined();
  });

  it('should update the correlation ID within an active context', () => {
    runWithCorrelationId('original-id', () => {
      expect(getCorrelationId()).toBe('original-id');

      setCorrelationId('updated-id');

      expect(getCorrelationId()).toBe('updated-id');
    });
  });

  it('should make the updated ID visible via getCorrelationId', () => {
    runWithCorrelationId('first', () => {
      setCorrelationId('second');
      const result = getCorrelationId();
      expect(result).toBe('second');
    });
  });
});

describe('runWithCorrelationId', () => {
  it('should set the correlation ID for the duration of the callback', () => {
    const captured: (string | undefined)[] = [];

    captured.push(getCorrelationId());

    runWithCorrelationId('during', () => {
      captured.push(getCorrelationId());
    });

    captured.push(getCorrelationId());

    expect(captured).toEqual([undefined, 'during', undefined]);
  });

  it('should return the callback return value', () => {
    const result = runWithCorrelationId('id-1', () => {
      return 42;
    });

    expect(result).toBe(42);
  });

  it('should support async callbacks', async () => {
    const result = await runWithCorrelationId('async-id', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return getCorrelationId();
    });

    expect(result).toBe('async-id');
  });

  it('should support nested calls where inner overrides outer', () => {
    runWithCorrelationId('outer', () => {
      expect(getCorrelationId()).toBe('outer');

      runWithCorrelationId('inner', () => {
        expect(getCorrelationId()).toBe('inner');
      });

      expect(getCorrelationId()).toBe('outer');
    });
  });

  it('should isolate contexts across concurrent async operations', async () => {
    const results: Record<string, string | undefined> = {};

    const task1 = runWithCorrelationId('task-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      results['task1'] = getCorrelationId();
    });

    const task2 = runWithCorrelationId('task-2', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      results['task2'] = getCorrelationId();
    });

    const task3 = runWithCorrelationId('task-3', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      results['task3'] = getCorrelationId();
    });

    await Promise.all([task1, task2, task3]);

    expect(results['task1']).toBe('task-1');
    expect(results['task2']).toBe('task-2');
    expect(results['task3']).toBe('task-3');
  });
});
