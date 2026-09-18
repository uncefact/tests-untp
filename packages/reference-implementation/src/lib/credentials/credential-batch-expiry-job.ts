import { appLogger } from '@/lib/api/logger';
import type { JobHandler, JobQueue } from '@/lib/jobs/types';
import { CREDENTIAL_BATCH_EXPIRY_JOB } from '@/lib/jobs/queue-names';
import { expireDueCredentialBatches } from '@/lib/prisma/repositories/credential-batch.repository';

const logger = appLogger.child({ module: 'credential-batch-expiry-job' });

export type CredentialBatchExpiryDependencies = {
  expire: (now: Date) => Promise<number>;
  now: () => Date;
};

export function defaultCredentialBatchExpiryDependencies(): CredentialBatchExpiryDependencies {
  return {
    expire: expireDueCredentialBatches,
    now: () => new Date(Date.now()),
  };
}

export function credentialBatchExpiryHandler(
  deps: CredentialBatchExpiryDependencies = defaultCredentialBatchExpiryDependencies(),
): JobHandler<Record<string, never>> {
  return async () => {
    const expired = await deps.expire(deps.now());
    logger.info({ expired }, 'Credential batch expiry sweep finished');
  };
}

/** Registers the worker-only expiry sweep. The web process never sends this queue. */
export function registerCredentialBatchExpiry(
  queue: JobQueue,
  deps: CredentialBatchExpiryDependencies = defaultCredentialBatchExpiryDependencies(),
): void {
  queue.register(CREDENTIAL_BATCH_EXPIRY_JOB, credentialBatchExpiryHandler(deps), { concurrency: 1 });
}
