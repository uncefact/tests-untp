/** Attempts `httpFetch` makes in total for one call, the first included. */
export const MAX_REQUEST_ATTEMPTS = 4;

/** Backoff step before the first retry; each later step doubles it. */
export const RETRY_BACKOFF_BASE_MS = 500;

/**
 * The largest backoff step. With attempts capped at
 * {@link MAX_REQUEST_ATTEMPTS} the steps are 0.5, 1 and 2 s, so this cap is
 * not reached; it bounds the step if the attempt cap is ever raised.
 */
export const RETRY_BACKOFF_MAX_STEP_MS = 5_000;

/** Retry budget, measured from the first attempt, when the caller passes no deadline. */
export const DEFAULT_RETRY_BUDGET_MS = 30_000;

/**
 * The per-attempt limit a repeatable read sets with `attemptTimeoutMs`:
 * the time an attempt may take until its response headers arrive.
 */
export const READ_ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * The longest single wait. A `Retry-After` asking for more returns the
 * response instead of waiting.
 */
export const MAX_RETRY_WAIT_MS = 30_000;

/**
 * The backoff step before retry `retry` (1 for the first retry):
 * min(5 s, 500 ms × 2^(retry − 1)).
 */
export function retryBackoffStepMs(retry: number): number {
  return Math.min(RETRY_BACKOFF_MAX_STEP_MS, RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, retry - 1));
}

/**
 * The full-jitter part of the wait before retry `retry`: a uniform draw in
 * [0, step). `random` must return a value in [0, 1), as `Math.random` does.
 *
 * @see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function retryDelayMs(retry: number, random: () => number = Math.random): number {
  return Math.floor(random() * retryBackoffStepMs(retry));
}

/**
 * A `Retry-After` value read against the clock: `absent` when there is no
 * header, `delay` with the milliseconds the server asked for (0 for a date
 * already past), and `invalid` for anything that is neither delay-seconds nor
 * one of the three HTTP-date forms. An invalid value is never treated as
 * "retry now", because that would resend sooner than the server asked.
 */
export type RetryAfter = { kind: 'absent' } | { kind: 'delay'; ms: number } | { kind: 'invalid' };

const DELAY_SECONDS_RE = /^\d+$/;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const LONG_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const MONTH_GROUP = `(${MONTHS.join('|')})`;
const TIME_GROUP = '(\\d{2}):(\\d{2}):(\\d{2})';
const IMF_FIXDATE_PARTS_RE = new RegExp(
  `^(${DAY_NAMES.join('|')}), (\\d{2}) ${MONTH_GROUP} (\\d{4}) ${TIME_GROUP} GMT$`,
);
const RFC850_DATE_RE = new RegExp(
  `^(${LONG_DAY_NAMES.join('|')}), (\\d{2})-${MONTH_GROUP}-(\\d{2}) ${TIME_GROUP} GMT$`,
);
const ASCTIME_DATE_RE = new RegExp(`^(${DAY_NAMES.join('|')}) ${MONTH_GROUP} (\\d{2}| \\d) ${TIME_GROUP} (\\d{4})$`);

type DateFields = {
  weekday: number;
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * The instant a calendar-valid date names, or undefined. The day must exist
 * in its month, the time must be within 00:00:00 to 23:59:60 (RFC 9110 allows
 * a leap second), and the day name must be that date's weekday. A date that
 * fails any of these is not one this parser will trust to time a resend.
 */
function instantOf(fields: DateFields): number | undefined {
  const { weekday, day, month, year, hour, minute, second } = fields;
  if (hour > 23 || minute > 59 || second > 60) return undefined;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
  if (day < 1 || day > daysInMonth) return undefined;
  // setUTCFullYear, because Date.UTC reads years 0 to 99 as 1900 to 1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  if (date.getUTCDay() !== weekday) return undefined;
  return date.getTime() + ((hour * 60 + minute) * 60 + second) * 1_000;
}

/**
 * RFC 9110 section 5.6.7: an rfc850-date timestamp that appears to be more
 * than 50 years in the future names the most recent past year with the same
 * last two digits. The whole timestamp is compared with the instant 50 years
 * after `nowMs`, not just its year, so a date later in the boundary year
 * already counts as more than 50 years ahead.
 */
function rfc850FullYear(
  fields: Omit<DateFields, 'weekday' | 'year'> & { twoDigitYear: number },
  nowMs: number,
): number {
  const { twoDigitYear, day, month, hour, minute, second } = fields;
  const currentYear = new Date(nowMs).getUTCFullYear();
  const year = Math.floor(currentYear / 100) * 100 + twoDigitYear;
  const limit = new Date(nowMs);
  limit.setUTCFullYear(currentYear + 50);
  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month, day);
  candidate.setUTCHours(hour, minute, second);
  return candidate.getTime() > limit.getTime() ? year - 100 : year;
}

/**
 * The instant an HTTP-date names, accepting the three forms RFC 9110 section
 * 5.6.7 requires a recipient to accept: IMF-fixdate, the obsolete rfc850-date
 * and the obsolete asctime-date (read as UTC, which the specification
 * defines it to be). Undefined for anything else, including ISO 8601 and any
 * zone other than GMT. `Date.parse` is not used because it accepts forms the
 * specification does not.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110#section-5.6.7
 */
export function parseHttpDate(value: string, nowMs: number): number | undefined {
  const imf = IMF_FIXDATE_PARTS_RE.exec(value);
  if (imf) {
    const [, dayName, day, month, year, hour, minute, second] = imf;
    return instantOf({
      weekday: DAY_NAMES.indexOf(dayName as (typeof DAY_NAMES)[number]),
      day: Number(day),
      month: MONTHS.indexOf(month as (typeof MONTHS)[number]),
      year: Number(year),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    });
  }
  const rfc850 = RFC850_DATE_RE.exec(value);
  if (rfc850) {
    const [, dayName, day, month, year, hour, minute, second] = rfc850;
    const fields = {
      day: Number(day),
      month: MONTHS.indexOf(month as (typeof MONTHS)[number]),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    };
    return instantOf({
      ...fields,
      weekday: LONG_DAY_NAMES.indexOf(dayName as (typeof LONG_DAY_NAMES)[number]),
      year: rfc850FullYear({ ...fields, twoDigitYear: Number(year) }, nowMs),
    });
  }
  const asctime = ASCTIME_DATE_RE.exec(value);
  if (asctime) {
    const [, dayName, month, day, hour, minute, second, year] = asctime;
    return instantOf({
      weekday: DAY_NAMES.indexOf(dayName as (typeof DAY_NAMES)[number]),
      day: Number(day.trim()),
      month: MONTHS.indexOf(month as (typeof MONTHS)[number]),
      year: Number(year),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    });
  }
  return undefined;
}

/**
 * Reads a `Retry-After` header value (RFC 9110 section 10.2.3): delay-seconds
 * (`1*DIGIT`) or an HTTP-date, measured against `nowMs`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3
 */
export function parseRetryAfter(value: string | null, nowMs: number): RetryAfter {
  if (value === null) return { kind: 'absent' };
  if (DELAY_SECONDS_RE.test(value)) {
    // Digits beyond a safe integer still mean "longer than any wait": the
    // value is kept as a number so the caller's cap refuses it.
    return { kind: 'delay', ms: Number(value) * 1_000 };
  }
  const instant = parseHttpDate(value, nowMs);
  if (instant === undefined) return { kind: 'invalid' };
  return { kind: 'delay', ms: Math.max(0, instant - nowMs) };
}
