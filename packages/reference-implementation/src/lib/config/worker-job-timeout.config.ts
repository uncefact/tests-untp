export const DEFAULT_WORKER_JOB_TIMEOUT_SECONDS = 300;
export const MAX_WORKER_JOB_TIMEOUT_SECONDS = 24 * 60 * 60;

/**
 * WORKER_JOB_TIMEOUT_SECONDS bounds every job this deployment's queue sends
 * or runs. Unset and blank use the five-minute default. A non-positive,
 * fractional or over-ceiling value is rejected so queue expiry and the
 * worker's attempt budget cannot silently disagree.
 */
export function readWorkerJobTimeoutSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = env.WORKER_JOB_TIMEOUT_SECONDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_WORKER_JOB_TIMEOUT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_WORKER_JOB_TIMEOUT_SECONDS) {
    throw new Error(
      `WORKER_JOB_TIMEOUT_SECONDS must be a positive integer number of seconds no greater than ${MAX_WORKER_JOB_TIMEOUT_SECONDS} when set; fix or unset it (unset uses ${DEFAULT_WORKER_JOB_TIMEOUT_SECONDS}).`,
    );
  }
  return parsed;
}
