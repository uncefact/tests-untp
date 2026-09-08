export const DEFAULT_STORED_COPY_READ_TIMEOUT_MS = 10_000;
/** A verify job waits out the whole budget on a slow read, so it has a ceiling. */
export const MAX_STORED_COPY_READ_TIMEOUT_MS = 120_000;

/**
 * LIBRARY_STORED_COPY_READ_TIMEOUT_MS bounds the worker's read of a durable
 * copy back from this deployment's own storage service, end to end, before a
 * verification generation runs. It is separate from VERIFY_FETCH_TIMEOUT_MS,
 * which bounds fetches of caller-supplied URLs on the web routes: the storage
 * service is ours and usually near, so the two budgets need not agree. Unset
 * or blank uses the default. A provided value that is not a positive integer
 * within the ceiling throws at worker boot with this message.
 */
export function readStoredCopyReadTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LIBRARY_STORED_COPY_READ_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STORED_COPY_READ_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_STORED_COPY_READ_TIMEOUT_MS) {
    throw new Error(
      `LIBRARY_STORED_COPY_READ_TIMEOUT_MS must be a positive integer number of milliseconds no greater than ${MAX_STORED_COPY_READ_TIMEOUT_MS} when set; fix or unset it (unset uses ${DEFAULT_STORED_COPY_READ_TIMEOUT_MS}).`,
    );
  }
  return parsed;
}
