import { parseMediaType } from './parse-media-type.js';

describe('parseMediaType', () => {
  describe('accepts valid media types', () => {
    it.each([
      'application/json',
      'text/plain',
      'application/vnd.api+json',
      'application/x-www-form-urlencoded',
      'image/svg+xml',
      'text/plain; charset=utf-8',
      'text/plain;charset=utf-8',
      'application/json; charset=utf-8; profile=foo',
      'text/plain; charset="utf-8"',
      'multipart/form-data; boundary="----WebKitFormBoundary"',
    ])('%s', (value) => {
      expect(parseMediaType(value)).toBe(value);
    });
  });

  describe('rejects malformed media types', () => {
    it.each([
      ['missing slash', 'application'],
      ['empty type', '/json'],
      ['empty subtype', 'application/'],
      ['whitespace in type', 'app lication/json'],
      ['whitespace in subtype', 'application/js on'],
      ['comma-separated list (not supported by this validator)', 'application/json, text/plain'],
      ['empty string', ''],
      ['unquoted parameter value with whitespace', 'text/plain; charset=ut f-8'],
    ])('%s', (_label, value) => {
      expect(parseMediaType(value)).toBeUndefined();
    });
  });

  describe('rejects header-injection vectors', () => {
    it('rejects CRLF in the value', () => {
      expect(parseMediaType('application/json\r\nX-Evil: pwn')).toBeUndefined();
    });
  });
});
