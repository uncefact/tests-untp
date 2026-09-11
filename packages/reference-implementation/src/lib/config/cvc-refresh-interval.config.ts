const DEFAULT_INTERVAL_HOURS = 24;
/**
 * Ceiling chosen so interval + maximum jitter stays under Node's setTimeout
 * range (2^31 - 1 ms, about 596 hours); a longer delay is silently changed
 * to 1 ms, which would turn the refresh into a continuous loop.
 */
const MAX_INTERVAL_HOURS = 500;

/**
 * Reads and validates the refresh cadence. Unset or blank uses the default;
 * an invalid override fails the boot, matching the posture of the other
 * boot-validated operator overrides (`CACHE_MAX_ENTRIES`, `RI_APP_URL`).
 */
export function resolveRefreshIntervalHours(): number {
  const raw = process.env.CVC_REFRESH_INTERVAL_HOURS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_INTERVAL_HOURS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_INTERVAL_HOURS) {
    throw new Error(
      `CVC_REFRESH_INTERVAL_HOURS must be a positive number of hours no greater than ${MAX_INTERVAL_HOURS}; got "${raw}". Unset it to use the default (${DEFAULT_INTERVAL_HOURS}).`,
    );
  }
  return parsed;
}
