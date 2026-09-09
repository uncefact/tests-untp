import { resolveConfiguredMaximum } from '@/lib/api/pagination';

const DEFAULT_MAX_BATCH_GET_IDS = 500;

const resolvedMaxBatchGetIds = resolveConfiguredMaximum(process.env.API_MAX_BATCH_GET_IDS, DEFAULT_MAX_BATCH_GET_IDS);

export const MAX_BATCH_GET_IDS = resolvedMaxBatchGetIds.value;

/** Warns once when the batch-get id maximum was supplied but could not be applied. */
export function warnOnRejectedMaxBatchGetIdsOverride(logger: {
  warn: (context: Record<string, unknown>, message: string) => void;
}): void {
  const raw = process.env.API_MAX_BATCH_GET_IDS;
  const resolved = resolveConfiguredMaximum(raw, DEFAULT_MAX_BATCH_GET_IDS);
  if (resolved.overrideRejected) {
    logger.warn(
      { API_MAX_BATCH_GET_IDS: raw, appliedMaximum: resolved.value },
      `API_MAX_BATCH_GET_IDS must be a positive integer; applying maximum ${resolved.value} instead`,
    );
  }
}
