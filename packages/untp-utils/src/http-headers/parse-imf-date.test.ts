import { parseImfDate } from './parse-imf-date.js';

describe('parseImfDate', () => {
  describe('accepts valid IMF-fixdate', () => {
    it.each(['Sun, 06 Nov 1994 08:49:37 GMT', 'Wed, 21 May 2026 12:00:00 GMT', 'Mon, 01 Jan 2024 00:00:00 GMT'])(
      '%s',
      (value) => {
        expect(parseImfDate(value)).toBe(value);
      },
    );
  });

  describe('rejects malformed dates', () => {
    it.each([
      ['lowercase day name', 'sun, 06 Nov 1994 08:49:37 GMT'],
      ['missing comma', 'Sun 06 Nov 1994 08:49:37 GMT'],
      ['1-digit day', 'Sun, 6 Nov 1994 08:49:37 GMT'],
      ['2-digit year', 'Sun, 06 Nov 94 08:49:37 GMT'],
      ['no GMT suffix', 'Sun, 06 Nov 1994 08:49:37'],
      ['UTC instead of GMT', 'Sun, 06 Nov 1994 08:49:37 UTC'],
      ['ISO-8601', '2026-05-21T12:00:00Z'],
      ['RFC 850 format', 'Sunday, 06-Nov-94 08:49:37 GMT'],
      ['asctime format', 'Sun Nov  6 08:49:37 1994'],
      ['empty string', ''],
      ['gibberish', 'not a date'],
    ])('%s', (_label, value) => {
      expect(parseImfDate(value)).toBeUndefined();
    });
  });

  describe('rejects header-injection vectors', () => {
    it('rejects CRLF in the value', () => {
      expect(parseImfDate('Sun, 06 Nov 1994 08:49:37 GMT\r\nX-Evil: pwn')).toBeUndefined();
    });
  });
});
