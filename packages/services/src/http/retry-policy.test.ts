/**
 * @jest-environment node
 */
import { MAX_RETRY_WAIT_MS, parseHttpDate, parseRetryAfter, retryBackoffStepMs, retryDelayMs } from './retry-policy';

// RFC 9110 section 5.6.7 gives these three as the same instant.
const RFC_EXAMPLE_INSTANT = Date.UTC(1994, 10, 6, 8, 49, 37);
const TEN_SECONDS_BEFORE = RFC_EXAMPLE_INSTANT - 10_000;
const NOW_2026 = Date.UTC(2026, 9, 21, 12, 0, 0);

describe('retryBackoffStepMs', () => {
  it.each([
    [1, 500],
    [2, 1_000],
    [3, 2_000],
    [4, 4_000],
    [5, 5_000],
    [12, 5_000],
  ])('retry %i steps %i ms', (retry, step) => {
    expect(retryBackoffStepMs(retry)).toBe(step);
  });
});

describe('retryDelayMs', () => {
  it('draws the full-jitter wait from zero up to the step', () => {
    expect(retryDelayMs(3, () => 0)).toBe(0);
    expect(retryDelayMs(3, () => 0.5)).toBe(1_000);
    expect(retryDelayMs(3, () => 0.9999)).toBe(1_999);
  });
});

describe('parseRetryAfter', () => {
  it('reports a missing header as absent', () => {
    expect(parseRetryAfter(null, NOW_2026)).toEqual({ kind: 'absent' });
  });

  it.each([
    ['8', 8_000],
    ['0', 0],
    ['120', 120_000],
  ])('reads delay-seconds %s', (value, ms) => {
    expect(parseRetryAfter(value, NOW_2026)).toEqual({ kind: 'delay', ms });
  });

  it('keeps an enormous delay-seconds value enormous so the cap refuses it', () => {
    const result = parseRetryAfter('9'.repeat(40), NOW_2026);
    expect(result.kind).toBe('delay');
    expect((result as { ms: number }).ms).toBeGreaterThan(MAX_RETRY_WAIT_MS);
  });

  it.each(['Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994'])(
    'gives the RFC 9110 example %s the same ten-second wait',
    (value) => {
      expect(parseRetryAfter(value, TEN_SECONDS_BEFORE)).toEqual({ kind: 'delay', ms: 10_000 });
    },
  );

  it('waits nothing for a date already past', () => {
    expect(parseRetryAfter('Sun, 06 Nov 1994 08:49:37 GMT', NOW_2026)).toEqual({ kind: 'delay', ms: 0 });
  });

  it.each([
    ['a zone other than GMT', 'Sun, 06 Nov 1994 08:49:37 PST'],
    ['ISO 8601', '1994-11-06T08:49:37Z'],
    ['a day that does not exist', 'Mon, 31 Feb 2026 00:00:00 GMT'],
    ['29 February in a common year', 'Sun, 29 Feb 2026 00:00:00 GMT'],
    ['29 February in a century that is not a leap year', 'Thu, 29 Feb 1900 00:00:00 GMT'],
    ['a day name that is not that date', 'Mon, 06 Nov 1994 08:49:37 GMT'],
    ['an hour past 23', 'Sun, 06 Nov 1994 24:00:00 GMT'],
    ['a minute past 59', 'Sun, 06 Nov 1994 08:60:00 GMT'],
    // Fails if the leap-second allowance widens past 60, which would time a
    // resend from a second that cannot exist.
    ['a second past the leap second', 'Sun, 06 Nov 1994 23:59:61 GMT'],
    ['an asctime second past the leap second', 'Sun Nov  6 23:59:61 1994'],
    ['a lower-case day name', 'sun, 06 Nov 1994 08:49:37 GMT'],
    ['an asctime date with a zone', 'Sun Nov  6 08:49:37 1994 GMT'],
    ['an rfc850 date with a short day name', 'Sun, 06-Nov-94 08:49:37 GMT'],
    ['a word', 'soon'],
    ['a negative number', '-5'],
    ['a fraction', '1.5'],
    ['two values folded together', '8, 9'],
    ['an empty value', ''],
  ])('refuses %s', (_label, value) => {
    expect(parseRetryAfter(value, NOW_2026)).toEqual({ kind: 'invalid' });
  });
});

describe('parseHttpDate', () => {
  it.each([
    ['Thu, 29 Feb 2024 00:00:00 GMT', Date.UTC(2024, 1, 29)],
    ['Tue, 29 Feb 2000 00:00:00 GMT', Date.UTC(2000, 1, 29)],
    ['Wed Nov 16 08:49:37 1994', Date.UTC(1994, 10, 16, 8, 49, 37)],
    ['Sun Nov 06 08:49:37 1994', RFC_EXAMPLE_INSTANT],
  ])('reads %s', (value, instant) => {
    expect(parseHttpDate(value, NOW_2026)).toBe(instant);
  });

  it('accepts a leap second as the following instant', () => {
    expect(parseHttpDate('Sun, 06 Nov 1994 23:59:60 GMT', NOW_2026)).toBe(Date.UTC(1994, 10, 7, 0, 0, 0));
  });

  // RFC 9110 section 5.6.7: an rfc850-date that appears to be more than 50
  // years in the future names the most recent past year with the same last
  // two digits. At NOW_2026 the boundary is 2076-10-21T12:00:00Z.
  it.each([
    ['one second before the boundary', 'Wednesday, 21-Oct-76 11:59:59 GMT', Date.UTC(2076, 9, 21, 11, 59, 59)],
    ['exactly at the boundary', 'Wednesday, 21-Oct-76 12:00:00 GMT', Date.UTC(2076, 9, 21, 12, 0, 0)],
    ['one second after the boundary', 'Thursday, 21-Oct-76 12:00:01 GMT', Date.UTC(1976, 9, 21, 12, 0, 1)],
    ['a later year past the boundary', 'Sunday, 06-Nov-77 00:00:00 GMT', Date.UTC(1977, 10, 6)],
    ['a near-future year', 'Wednesday, 06-Nov-30 00:00:00 GMT', Date.UTC(2030, 10, 6)],
  ])('reads a two-digit rfc850 year %s', (_label, value, instant) => {
    expect(parseHttpDate(value, NOW_2026)).toBe(instant);
  });

  it('refuses a weekday that matches only the year on the wrong side of the boundary', () => {
    // 2076-10-21T12:00:01Z is a Wednesday, but it lies past the boundary and
    // so names 1976, a Thursday. Fails if the year is chosen by comparing
    // year numbers alone.
    expect(parseHttpDate('Wednesday, 21-Oct-76 12:00:01 GMT', NOW_2026)).toBeUndefined();
  });

  it('reads Saturday, 06-Nov-76 as a past date in 1976 and waits only the jitter', () => {
    // 6 November 2076 is more than 50 years after NOW_2026, so the date names
    // 1976, which was a Saturday. Fails if the year is compared without its
    // month and day: 2076 would be chosen and the weekday check would refuse it.
    expect(parseHttpDate('Saturday, 06-Nov-76 00:00:00 GMT', NOW_2026)).toBe(Date.UTC(1976, 10, 6));
    expect(parseRetryAfter('Saturday, 06-Nov-76 00:00:00 GMT', NOW_2026)).toEqual({ kind: 'delay', ms: 0 });
  });

  it('measures 50 years from 29 February as ending on 1 March', () => {
    // With no 29 February in 2078, the boundary rolls to 1 March 2078 at
    // the same time of day.
    const leapDayNoon = Date.UTC(2028, 1, 29, 12, 0, 0);
    expect(parseHttpDate('Tuesday, 01-Mar-78 12:00:00 GMT', leapDayNoon)).toBe(Date.UTC(2078, 2, 1, 12, 0, 0));
    expect(parseHttpDate('Wednesday, 01-Mar-78 12:00:01 GMT', leapDayNoon)).toBe(Date.UTC(1978, 2, 1, 12, 0, 1));
  });
});
