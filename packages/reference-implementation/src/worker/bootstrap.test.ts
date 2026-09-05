const validateConfiguredEncryptionKey = jest.fn(async () => undefined);
jest.mock('@/lib/encryption/encryption-key-boot', () => ({ validateConfiguredEncryptionKey }));
jest.mock('@/lib/api/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = () => logger;
  return { apiLogger: logger };
});
// The handler graph reaches the services server barrel, whose DID stack
// cannot resolve under jest; the boot's own order is what is under test.
jest.mock('@/lib/library/verify-generation-job', () => ({ registerLibraryJobs: jest.fn() }));
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { $queryRawUnsafe: jest.fn(async () => []), $disconnect: jest.fn() },
}));
// pg-boss ships ESM only and the unit config does not transform it; the
// queue is not under test here.
jest.mock('@/lib/jobs/app-job-queue', () => ({ createJobQueue: jest.fn(), resolveQueueConnectionString: jest.fn() }));

import { requireEncryptionKeyOnBoot } from './bootstrap';

const KEY = 'a'.repeat(64);

describe('requireEncryptionKeyOnBoot', () => {
  const saved = {
    DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY,
    SERVICE_ENCRYPTION_KEY: process.env.SERVICE_ENCRYPTION_KEY,
  };
  beforeEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.SERVICE_ENCRYPTION_KEY;
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
});
