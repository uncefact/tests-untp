import { EventEmitter } from 'node:events';
import { installShutdown, withTimeout } from './shutdown';

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
// jsdom has no setImmediate; a few macrotask turns let the awaited steps settle.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('installShutdown', () => {
  it('runs every step in order on SIGTERM and exits 0 when all succeed', async () => {
    const order: string[] = [];
    const exit = jest.fn();
    const signals = new EventEmitter();
    installShutdown({
      logger: logger() as never,
      exit,
      signals,
      steps: ['queue', 'prisma', 'telemetry'].map((name) => ({
        name,
        run: async () => {
          order.push(name);
        },
      })),
    });
    signals.emit('SIGTERM');
    await flush();
    expect(order).toEqual(['queue', 'prisma', 'telemetry']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps going past a failed step, so a failed drain never skips the Prisma disconnect, and exits 1', async () => {
    const order: string[] = [];
    const exit = jest.fn();
    const log = logger();
    const shutdown = installShutdown({
      logger: log as never,
      exit,
      signals: new EventEmitter(),
      steps: [
        {
          name: 'queue',
          run: async () => {
            throw new Error('drain failed');
          },
        },
        {
          name: 'prisma',
          run: async () => {
            order.push('prisma');
          },
        },
      ],
    });
    await shutdown();
    expect(order).toEqual(['prisma']);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'queue' }),
      'Shutdown step failed; continuing with the rest',
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('a non-critical step that fails is logged and leaves the exit code at 0', async () => {
    // The telemetry flush: a deployment with no collector must still stop
    // cleanly. Fails if the flag is dropped or the warn becomes an error.
    const exit = jest.fn();
    const log = logger();
    const shutdown = installShutdown({
      logger: log as never,
      exit,
      signals: new EventEmitter(),
      steps: [
        { name: 'queue', run: async () => undefined },
        {
          name: 'telemetry',
          nonCritical: true,
          run: async () => {
            throw new Error('no collector');
          },
        },
      ],
    });
    await shutdown();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'telemetry' }),
      'Shutdown step failed; not counted against the exit code',
    );
    expect(log.error).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when the steps outrun the deadline', async () => {
    jest.useFakeTimers();
    try {
      const exit = jest.fn();
      const shutdown = installShutdown({
        logger: logger() as never,
        exit,
        signals: new EventEmitter(),
        deadlineMs: 1_000,
        steps: [{ name: 'hung', run: () => new Promise(() => undefined) }],
      });
      const running = shutdown();
      await jest.advanceTimersByTimeAsync(1_000);
      await running;
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('names the step that was still running when the deadline passed', async () => {
    jest.useFakeTimers();
    try {
      const exit = jest.fn();
      const log = logger();
      const shutdown = installShutdown({
        logger: log as never,
        exit,
        signals: new EventEmitter(),
        deadlineMs: 1_000,
        steps: [
          { name: 'queue', run: async () => undefined },
          { name: 'prisma', run: () => new Promise(() => undefined) },
        ],
      });
      const running = shutdown();
      await jest.advanceTimersByTimeAsync(1_000);
      await running;
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'prisma' }),
        'Shutdown exceeded its deadline; exiting',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('a critical failure beside a non-critical one still exits 1', async () => {
    const exit = jest.fn();
    const shutdown = installShutdown({
      logger: logger() as never,
      exit,
      signals: new EventEmitter(),
      steps: [
        {
          name: 'queue',
          run: async () => {
            throw new Error('drain failed');
          },
        },
        {
          name: 'telemetry',
          nonCritical: true,
          run: async () => {
            throw new Error('no collector');
          },
        },
      ],
    });
    await shutdown();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('a second signal during shutdown exits 1 at once', async () => {
    const exit = jest.fn();
    const signals = new EventEmitter();
    let release: () => void = () => undefined;
    installShutdown({
      logger: logger() as never,
      exit,
      signals,
      steps: [{ name: 'slow', run: () => new Promise<void>((resolve) => (release = resolve)) }],
    });
    signals.emit('SIGTERM');
    await flush();
    expect(exit).not.toHaveBeenCalled();
    signals.emit('SIGINT');
    await flush();
    expect(exit).toHaveBeenCalledWith(1);
    release();
  });
});

describe('withTimeout', () => {
  it('passes a value that arrives in time through unchanged', async () => {
    await expect(withTimeout(Promise.resolve('flushed'), 1_000, 'telemetry shutdown')).resolves.toBe('flushed');
  });

  it('rejects, naming the step and the bound, when the promise outlives it', async () => {
    jest.useFakeTimers();
    try {
      const never = new Promise<void>(() => undefined);
      const bounded = withTimeout(never, 5_000, 'telemetry shutdown');
      const outcome = bounded.then(
        () => 'resolved',
        (error: Error) => error.message,
      );
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(outcome).resolves.toBe('telemetry shutdown did not finish within 5000 ms');
    } finally {
      jest.useRealTimers();
    }
  });
});
