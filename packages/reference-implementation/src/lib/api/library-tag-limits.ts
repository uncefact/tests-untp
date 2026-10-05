import { resolveConfiguredMaximum } from '@/lib/api/pagination';

export const DEFAULT_MAX_TAGS_PER_RECORD = 10;
export const DEFAULT_MAX_TAG_LENGTH = 64;

type Env = Record<string, string | undefined>;

/*
 * The two limits on a library record's tags (#1108), resolved like
 * API_MAX_PAGE_LIMIT and API_MAX_BATCH_LIMIT: an absent value uses the
 * default, and an unusable one uses the default and is reported once at web
 * startup.
 *
 * Unlike those two siblings, the values are read when a request is admitted
 * rather than once at module load. The worker imports the issuance request
 * schemas, so a module-level read would make the worker resolve settings it
 * never enforces: the limits apply only when a request is admitted, and the
 * worker issues what the web already admitted. Reading per call also lets a
 * test set a limit without reloading modules.
 */

/** Maximum number of tags one record may hold, from API_MAX_TAGS_PER_RECORD. */
export function readMaxTagsPerRecord(env: Env = process.env): number {
  return resolveConfiguredMaximum(env.API_MAX_TAGS_PER_RECORD, DEFAULT_MAX_TAGS_PER_RECORD).value;
}

/** Maximum length of one tag in characters, from API_MAX_TAG_LENGTH. */
export function readMaxTagLength(env: Env = process.env): number {
  return resolveConfiguredMaximum(env.API_MAX_TAG_LENGTH, DEFAULT_MAX_TAG_LENGTH).value;
}

/** Warns once for each tag limit that was supplied but could not be applied. */
export function warnOnRejectedLibraryTagLimitOverrides(logger: {
  warn: (context: Record<string, unknown>, message: string) => void;
}): void {
  const settings = [
    ['API_MAX_TAGS_PER_RECORD', DEFAULT_MAX_TAGS_PER_RECORD],
    ['API_MAX_TAG_LENGTH', DEFAULT_MAX_TAG_LENGTH],
  ] as const;
  for (const [name, fallback] of settings) {
    const raw = process.env[name];
    const resolved = resolveConfiguredMaximum(raw, fallback);
    if (resolved.overrideRejected) {
      logger.warn(
        { [name]: raw, appliedMaximum: resolved.value },
        `${name} must be a positive integer; applying maximum ${resolved.value} instead`,
      );
    }
  }
}
