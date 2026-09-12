const validateConfiguredEncryptionKey = jest.fn(async () => undefined);
jest.mock('@/lib/encryption/encryption-key-boot', () => ({ validateConfiguredEncryptionKey }));
jest.mock('@/lib/api/logger');
// The handler graph reaches the services server barrel, whose DID stack
// cannot resolve under jest; the boot's own order is what is under test.
jest.mock('@/lib/library/verify-generation-job', () => ({ registerLibraryJobs: jest.fn() }));
jest.mock('@/lib/library/reconcile-pending-runs-job', () => ({ registerPendingRunReconciliation: jest.fn() }));
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $queryRawUnsafe: jest.fn(async () => []), $disconnect: jest.fn() },
}));
// pg-boss ships ESM only and the unit config does not transform it; the
// queue is not under test here.
jest.mock('@/lib/jobs/app-job-queue', () => ({ createJobQueue: jest.fn(), resolveQueueConnectionString: jest.fn() }));
// Telemetry construction is covered by the preflight and SDK tests. Keep the
// NodeSDK's Node-only dependency graph out of this handler-focused jsdom suite.
jest.mock('../lib/observability/start-sdk', () => ({ buildNodeSdk: jest.fn() }));

import { requireEncryptionKeyOnBoot, runWorker } from './bootstrap';

const KEY = 'a'.repeat(64);

describe('requireEncryptionKeyOnBoot', () => {
  const saved = {
    DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY,
    SERVICE_ENCRYPTION_KEY: process.env.SERVICE_ENCRYPTION_KEY,
    WORKER_JOB_TIMEOUT_SECONDS: process.env.WORKER_JOB_TIMEOUT_SECONDS,
  };
  beforeEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.SERVICE_ENCRYPTION_KEY;
    delete process.env.WORKER_JOB_TIMEOUT_SECONDS;
    validateConfiguredEncryptionKey.mockClear();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('refuses to start without a key, naming the variable, whatever the database holds', async () => {
    // The web skips this check when the key is unset; the worker must not,
    // because every job it can claim needs the key. Fails if the worker is
    // ever changed back to the web's rule.
    await expect(requireEncryptionKeyOnBoot()).rejects.toThrow(
      expect.objectContaining({
        code: 'worker.encryption-key-missing',
        message: expect.stringContaining('DATA_ENCRYPTION_KEY'),
      }),
    );
    expect(validateConfiguredEncryptionKey).not.toHaveBeenCalled();
  });

  it('runs the shared placeholder and existing-data checks on a configured key', async () => {
    process.env.DATA_ENCRYPTION_KEY = KEY;
    await expect(requireEncryptionKeyOnBoot()).resolves.toBeUndefined();
    expect(validateConfiguredEncryptionKey).toHaveBeenCalledWith(KEY);
  });

  it('runs the shared worker preflight before the existing image checks', async () => {
    process.env.DATA_ENCRYPTION_KEY = KEY;
    process.env.WORKER_JOB_TIMEOUT_SECONDS = '5';

    await expect(
      runWorker({
        sdk: { shutdown: jest.fn() },
        migrationsDir: '/directory-that-does-not-exist',
      }),
    ).rejects.toThrow(
      'WORKER_JOB_TIMEOUT_SECONDS must be an integer number of seconds between 30 and 86400 when set; fix or unset it (unset uses 300).',
    );
  });
});
