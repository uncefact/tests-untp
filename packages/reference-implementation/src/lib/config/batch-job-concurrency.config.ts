const DEFAULT_BATCH_JOB_CONCURRENCY = 1;

/** Reads the worker-only concurrency cap for ordinary batch issuance jobs. */
export function readBatchJobConcurrency(
  env: { BATCH_JOB_CONCURRENCY?: string } = process.env as { BATCH_JOB_CONCURRENCY?: string },
): number {
  const raw = env.BATCH_JOB_CONCURRENCY?.trim();
  if (raw === undefined || raw === '') return DEFAULT_BATCH_JOB_CONCURRENCY;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('BATCH_JOB_CONCURRENCY must be a positive integer');
  }
  return value;
}
