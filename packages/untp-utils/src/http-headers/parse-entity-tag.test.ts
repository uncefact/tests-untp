import { parseEntityTag } from './parse-entity-tag.js';

describe('parseEntityTag', () => {
  describe('accepts valid entity-tags', () => {
    it.each([
      '""',
      '"abc"',
      '"33a64df551425fcc55e4d42a148795d9f25f89d4"',
      'W/"abc"',
      'W/""',
      '"a-b-c.d"',
      '"!@#$%^&*()"',
    ])('%s', (value) => {
      expect(parseEntityTag(value)).toBe(value);
    });
  });

  describe('rejects malformed entity-tags', () => {
    it.each([
      ['unquoted value', 'abc'],
      ['single-quoted value', "'abc'"],
      ['missing closing quote', '"abc'],
      ['missing opening quote', 'abc"'],
      ['embedded double quote', '"a"b"'],
      ['lower-case w prefix', 'w/"abc"'],
      ['w prefix without slash', 'W"abc"'],
      ['empty string', ''],
      ['trailing whitespace', '"abc" '],
      ['multiple etags (not supported)', '"abc", "def"'],
    ])('%s', (_label, value) => {
      expect(parseEntityTag(value)).toBeUndefined();
    });
  });

  describe('rejects header-injection vectors', () => {
    it('rejects CRLF in the value', () => {
      expect(parseEntityTag('"abc"\r\nX-Evil: pwn')).toBeUndefined();
    });

    it('rejects embedded null byte', () => {
      expect(parseEntityTag('"a\x00b"')).toBeUndefined();
    });
  });
});
