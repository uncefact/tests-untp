export const DEFAULT_STORED_COPY_READ_TIMEOUT_MS = 10_000;
/** A verify job, and now a recovery request, wait out the whole budget on a slow read, so it has a ceiling. */
export const MAX_STORED_COPY_READ_TIMEOUT_MS = 120_000;

/**
 * LIBRARY_STORED_COPY_READ_TIMEOUT_MS bounds every read of a durable copy back
 * from this deployment's own storage service, end to end. It has two callers,
 * not one: the worker, before a verification generation runs, and the
 * key-bearing recovery on `POST /api/v1/library/{id}/verify`, which reads the
 * record's own copy inside the request. Raising it for a slow worker
 * therefore also raises what a caller can wait on that route, before the
 * decrypt, the store and the finalisation are added to it. That shared budget
 * is accepted: the same read against the same service should not have two
 * answers, and the ceiling below still bounds both. It is separate from
 * FETCH_TIMEOUT_MS,
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
