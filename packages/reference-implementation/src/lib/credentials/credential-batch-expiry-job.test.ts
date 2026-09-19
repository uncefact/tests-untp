jest.mock('@/lib/api/logger');
jest.mock('@/lib/prisma/repositories/credential-batch.repository', () => ({
  expireDueCredentialBatches: jest.fn(),
}));

const loggerCalls = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;

import { CREDENTIAL_BATCH_EXPIRY_JOB } from '@/lib/jobs/queue-names';
import {
  credentialBatchExpiryHandler,
  registerCredentialBatchExpiry,
  type CredentialBatchExpiryDependencies,
} from './credential-batch-expiry-job';

const NOW = new Date('2026-09-18T00:00:00.000Z');

function dependencies(overrides: Partial<CredentialBatchExpiryDependencies> = {}): CredentialBatchExpiryDependencies {
  return {
    expire: jest.fn().mockResolvedValue(3),
    now: jest.fn(() => NOW),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('credentialBatchExpiryHandler', () => {
  it('expires due batches at the dependency clock and logs the count', async () => {
    // Regression: using a fresh clock or omitting the count would make the sweep boundary and result unverifiable.
    const deps = dependencies();

    await credentialBatchExpiryHandler(deps)({} as never, {} as never);

    expect(deps.now).toHaveBeenCalledTimes(1);
    expect(deps.expire).toHaveBeenCalledWith(NOW);
    expect(loggerCalls.info).toHaveBeenCalledWith({ expired: 3 }, 'Credential batch expiry sweep finished');
  });
});

describe('registerCredentialBatchExpiry', () => {
  it('registers the expiry handler under its queue name with one concurrent sweep', async () => {
    // Regression: a missing registration, wrong queue name or overlapping sweep would leave expiry unreachable or concurrent.
    const queue = { register: jest.fn() };
    const deps = dependencies();

    registerCredentialBatchExpiry(queue as never, deps);

    expect(queue.register).toHaveBeenCalledWith(CREDENTIAL_BATCH_EXPIRY_JOB, expect.any(Function), {
      concurrency: 1,
    });

    const registeredHandler = queue.register.mock.calls[0][1] as ReturnType<typeof credentialBatchExpiryHandler>;
    await registeredHandler({} as never, {} as never);
    expect(deps.expire).toHaveBeenCalledWith(NOW);
  });
});
