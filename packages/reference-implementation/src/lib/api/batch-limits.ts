import { resolveConfiguredMaximum } from '@/lib/api/pagination';

const DEFAULT_MAX_BATCH_LIMIT = 500;

const resolvedMaxBatchLimit = resolveConfiguredMaximum(process.env.API_MAX_BATCH_LIMIT, DEFAULT_MAX_BATCH_LIMIT);

export const MAX_BATCH_LIMIT = resolvedMaxBatchLimit.value;

/** Warns once when the batch-get id maximum was supplied but could not be applied. */
export function warnOnRejectedMaxBatchLimitOverride(logger: {
  warn: (context: Record<string, unknown>, message: string) => void;
}): void {
  const raw = process.env.API_MAX_BATCH_LIMIT;
  const resolved = resolveConfiguredMaximum(raw, DEFAULT_MAX_BATCH_LIMIT);
  if (resolved.overrideRejected) {
    logger.warn(
      { API_MAX_BATCH_LIMIT: raw, appliedMaximum: resolved.value },
      `API_MAX_BATCH_LIMIT must be a positive integer; applying maximum ${resolved.value} instead`,
    );
  }
}
