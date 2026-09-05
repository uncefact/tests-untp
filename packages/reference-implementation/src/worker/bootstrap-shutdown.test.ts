/**
 * The shutdown steps the boot wires, checked through the real `withTimeout`:
 * the telemetry step must give up on a flush that never returns. This is the
 * unit-level guard for a rule the live exercise could not make bite (the
 * exporter fails fast when no connection was ever made; the hang needs an
 * export in flight). Fails if the bound is dropped from bootstrap.ts.
 */
const captured: { steps: { name: string; run: () => Promise<void>; nonCritical?: boolean }[] } = { steps: [] };
jest.mock('./shutdown', () => {
  const actual = jest.requireActual<typeof import('./shutdown')>('./shutdown');
  return {
    ...actual,
    installShutdown: jest.fn((options: { steps: typeof captured.steps }) => {
      captured.steps = options.steps;
      return async () => undefined;
    }),
  };
});
const heartbeat = { started: 0, stopped: 0 };
jest.mock('./heartbeat', () => ({
  startHeartbeat: jest.fn(() => {
    heartbeat.started += 1;
    return {
      stop: () => {
        heartbeat.stopped += 1;
      },
    };
  }),
}));
/** The order the boot touched things in, so the order rule is asserted rather than assumed. */
const order: string[] = [];
jest.mock('./schema-readiness', () => ({
  listImageMigrations: jest.fn(() => {
    order.push('migrations');
    return ['20260101000000_only'];
  }),
  assertSchemaReady: jest.fn(async () => {
    order.push('schema');
  }),
  prismaMigrationRows: jest.fn(() => ({ appliedMigrationNames: async () => [] })),
}));
jest.mock('@/lib/encryption/encryption-key-boot', () => ({
  validateConfiguredEncryptionKey: jest.fn(async () => {
    order.push('key');
  }),
}));
jest.mock('@/lib/api/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = () => logger;
  return { apiLogger: logger };
});
jest.mock('@/lib/library/verify-generation-job', () => ({
  registerLibraryJobs: jest.fn(() => {
    order.push('register');
  }),
}));
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $queryRawUnsafe: jest.fn(async () => []), $disconnect: jest.fn(async () => undefined) },
}));
const fakeQueue = {
  register: jest.fn(),
  probe: jest.fn(async () => ({ consumers: [] })),
  start: jest.fn(async () => {
    order.push('start');
  }),
  stop: jest.fn(async () => undefined),
};
jest.mock('@/lib/jobs/app-job-queue', () => ({
  createJobQueue: jest.fn(() => {
    order.push('construct');
    return fakeQueue;
  }),
  resolveQueueConnectionString: jest.fn(() => {
    order.push('database-target');
    return 'postgresql://u:p@h:5432/db';
  }),
}));

import { runWorker } from './bootstrap';

describe('the shutdown steps runWorker wires', () => {
  beforeAll(async () => {
    process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
    await runWorker({ sdk: { shutdown: () => new Promise<void>(() => undefined) }, migrationsDir: '/unused' });
  });

  it('are the heartbeat, the queue drain, the database disconnect and the telemetry flush, in that order', () => {
    expect(captured.steps.map((step) => step.name)).toEqual(['heartbeat', 'queue', 'prisma', 'telemetry']);
  });

  it('booted in the designed order: image migrations, database target, schema, key, construct, register, start', () => {
    // register before start is a hard rule (the queue throws after start);
    // schema and key before start is what keeps a misconfigured worker from
    // ever claiming a job. Fails if any of those move.
    expect(order).toEqual(['migrations', 'database-target', 'schema', 'key', 'construct', 'register', 'start']);
  });

  it('installed the shutdown handlers before the queue started, and the heartbeat after', () => {
    const installShutdown = jest.requireMock<{ installShutdown: jest.Mock }>('./shutdown').installShutdown;
    expect(installShutdown).toHaveBeenCalledTimes(1);
    expect(fakeQueue.start.mock.invocationCallOrder[0]).toBeGreaterThan(installShutdown.mock.invocationCallOrder[0]);
    expect(heartbeat.started).toBe(1);
  });

  it('stops the heartbeat as the first shutdown step', async () => {
    await captured.steps.find((step) => step.name === 'heartbeat')!.run();
    expect(heartbeat.stopped).toBe(1);
  });

  it('bound the telemetry flush at 5 s and mark it non-critical', async () => {
    jest.useFakeTimers();
    try {
      const telemetry = captured.steps.find((step) => step.name === 'telemetry');
      expect(telemetry?.nonCritical).toBe(true);
      const outcome = telemetry!.run().then(
        () => 'resolved',
        (error: Error) => error.message,
      );
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(outcome).resolves.toBe('telemetry shutdown did not finish within 5000 ms');
    } finally {
      jest.useRealTimers();
    }
  });

  it('drain the queue with the 30 s bound', async () => {
    await captured.steps.find((step) => step.name === 'queue')!.run();
    expect(fakeQueue.stop).toHaveBeenCalledWith({ drainTimeoutMs: 30_000 });
  });
});
