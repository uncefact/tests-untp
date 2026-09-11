/**
 * The reconciliation schedule's two boot-window rules: it is not recorded on a
 * queue the shutdown steps have already stopped, and a failure to record it
 * fails the boot with a named message like every other step.
 */
const captured: { steps: { name: string; run: () => Promise<void> }[] } = { steps: [] };
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
const startHeartbeat = jest.fn(() => ({ stop: () => undefined }));
jest.mock('./heartbeat', () => ({ startHeartbeat: (...args: unknown[]) => startHeartbeat(...(args as [])) }));
jest.mock('./schema-readiness', () => ({
  listImageMigrations: jest.fn(() => ['20260101000000_only']),
  assertSchemaReady: jest.fn(async () => undefined),
  prismaMigrationRows: jest.fn(() => ({ appliedMigrationNames: async () => [] })),
}));
jest.mock('@/lib/encryption/encryption-key-boot', () => ({
  validateConfiguredEncryptionKey: jest.fn(async () => undefined),
}));
jest.mock('@/lib/api/logger');
jest.mock('@/lib/library/verify-generation-job', () => ({ registerLibraryJobs: jest.fn() }));
jest.mock('@/lib/library/reconcile-pending-runs-job', () => ({
  registerPendingRunReconciliation: jest.fn(),
}));
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $queryRawUnsafe: jest.fn(async () => []), $disconnect: jest.fn(async () => undefined) },
}));

const fakeQueue = {
  register: jest.fn(),
  probe: jest.fn(async () => ({ consumers: [] })),
  start: jest.fn(async () => undefined),
  schedule: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
};
jest.mock('@/lib/jobs/app-job-queue', () => ({
  createJobQueue: jest.fn(() => fakeQueue),
  resolveQueueConnectionString: jest.fn(() => 'postgresql://u:p@h:5432/db'),
}));

import { LIBRARY_RECONCILE_PENDING_RUNS_JOB } from '@/lib/jobs/queue-names';
import { runWorker } from './bootstrap';
import { WorkerBootError } from './errors';

const OPTIONS = { sdk: { shutdown: async () => undefined }, migrationsDir: '/unused' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.LIBRARY_RECONCILE_PENDING_RUNS_CRON;
  delete process.env.LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE;
  delete process.env.WORKER_JOB_TIMEOUT_SECONDS;
  fakeQueue.start.mockImplementation(async () => undefined);
  fakeQueue.schedule.mockImplementation(async () => undefined);
});

describe('the reconciliation schedule at worker boot', () => {
  it('is recorded on a queue that started cleanly', () => {
    return runWorker(OPTIONS).then(() => {
      expect(fakeQueue.schedule).toHaveBeenCalledWith(LIBRARY_RECONCILE_PENDING_RUNS_JOB, '*/10 * * * *');
      expect(startHeartbeat).toHaveBeenCalledTimes(1);
      expect(startHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ maxJobMs: 360_000 }));
    });
  });

  it('moves the heartbeat active-job window with the configured worker timeout', async () => {
    process.env.WORKER_JOB_TIMEOUT_SECONDS = '600';

    await runWorker(OPTIONS);

    expect(startHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ maxJobMs: 660_000 }));
  });

  it('is recorded on the cadence LIBRARY_RECONCILE_PENDING_RUNS_CRON sets', async () => {
    // The operator owns the sweep cadence (startup.md). Fails if the boot
    // ignores the variable and records the default.
    process.env.LIBRARY_RECONCILE_PENDING_RUNS_CRON = '*/5 * * * *';

    await expect(runWorker(OPTIONS)).resolves.toBeUndefined();

    expect(fakeQueue.schedule).toHaveBeenCalledWith(LIBRARY_RECONCILE_PENDING_RUNS_JOB, '*/5 * * * *');
  });

  it('fails the boot, naming the variable, before the queue exists when the cadence is malformed', async () => {
    // A malformed cadence is caught before the queue is built, so the worker
    // never starts a consumer it would then have to stop. Fails if the value
    // reaches queue.schedule, or if the error is not the named boot error.
    process.env.LIBRARY_RECONCILE_PENDING_RUNS_CRON = 'every ten minutes';

    await expect(runWorker(OPTIONS)).rejects.toMatchObject({
      code: 'worker.configuration-invalid',
      message: expect.stringContaining('LIBRARY_RECONCILE_PENDING_RUNS_CRON'),
    });

    expect(fakeQueue.start).not.toHaveBeenCalled();
    expect(fakeQueue.schedule).not.toHaveBeenCalled();
    expect(startHeartbeat).not.toHaveBeenCalled();
  });

  it('fails the boot, naming the variable, when the sweep batch size is malformed', async () => {
    process.env.LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE = 'lots';

    await expect(runWorker(OPTIONS)).rejects.toMatchObject({
      code: 'worker.configuration-invalid',
      message: expect.stringContaining('LIBRARY_RECONCILE_PENDING_RUNS_BATCH_SIZE'),
    });

    expect(fakeQueue.start).not.toHaveBeenCalled();
  });

  it('fails the boot, naming the variable, when the worker job timeout is malformed', async () => {
    process.env.WORKER_JOB_TIMEOUT_SECONDS = '10s';

    await expect(runWorker(OPTIONS)).rejects.toMatchObject({
      code: 'worker.configuration-invalid',
      message: expect.stringContaining('WORKER_JOB_TIMEOUT_SECONDS'),
    });

    expect(fakeQueue.start).not.toHaveBeenCalled();
  });

  it('is skipped when a signal ran the shutdown steps during the queue start', async () => {
    // The shutdown steps stop the queue, so scheduling afterwards would record
    // a cron row against a released pool and take the process down with a
    // driver error. Fails if a graceful stop is reported as a boot crash.
    fakeQueue.start.mockImplementation(async () => {
      for (const step of captured.steps) await step.run();
    });

    await expect(runWorker(OPTIONS)).resolves.toBeUndefined();

    expect(fakeQueue.schedule).not.toHaveBeenCalled();
    expect(startHeartbeat).not.toHaveBeenCalled();
  });

  it('does not start the heartbeat when a signal arrives while the schedule is in flight', async () => {
    // The shutdown steps have already stopped the heartbeat by then, so
    // starting one here leaves a proof running for a process on its way out
    // and the container reads healthy while it drains. Fails if the flag is
    // read once, before the schedule, rather than again after it.
    fakeQueue.schedule.mockImplementation(async () => {
      for (const step of captured.steps) await step.run();
    });

    await expect(runWorker(OPTIONS)).resolves.toBeUndefined();

    expect(fakeQueue.schedule).toHaveBeenCalledTimes(1);
    expect(startHeartbeat).not.toHaveBeenCalled();
  });

  it('fails the boot with a named code when the schedule cannot be recorded', async () => {
    // Every other boot step fails with a message naming what is wrong, and
    // startup.md states that contract. Fails if a driver error is allowed to
    // reach the operator unnamed, or if the worker starts without the sweep
    // and leaves lost generations pending for ever.
    fakeQueue.schedule.mockRejectedValue(new Error('relation "schedule" does not exist'));

    const failure = await runWorker(OPTIONS).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WorkerBootError);
    expect((failure as WorkerBootError).code).toBe('worker.reconciliation-schedule-failed');
    expect((failure as WorkerBootError).message).toContain(LIBRARY_RECONCILE_PENDING_RUNS_JOB);
    expect(startHeartbeat).not.toHaveBeenCalled();
  });
});
