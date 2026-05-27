import { isSafeHeaderValue } from './is-safe-header-value.js';

describe('isSafeHeaderValue', () => {
  it('accepts printable ASCII', () => {
    expect(isSafeHeaderValue('foo')).toBe(true);
    expect(isSafeHeaderValue('"abc"')).toBe(true);
    expect(isSafeHeaderValue('application/json; charset=utf-8')).toBe(true);
  });

  it('accepts the empty string', () => {
    expect(isSafeHeaderValue('')).toBe(true);
  });

  it('rejects carriage return', () => {
    expect(isSafeHeaderValue('foo\rbar')).toBe(false);
  });

  it('rejects line feed', () => {
    expect(isSafeHeaderValue('foo\nbar')).toBe(false);
  });

  it('rejects CRLF (the canonical header-injection vector)', () => {
    expect(isSafeHeaderValue('"abc"\r\nX-Evil: pwn')).toBe(false);
  });

  it('rejects NUL bytes', () => {
    expect(isSafeHeaderValue('foo\x00bar')).toBe(false);
  });

  it('rejects every control character (0x00 to 0x1f)', () => {
    for (let i = 0; i < 0x20; i += 1) {
      expect(isSafeHeaderValue(`a${String.fromCharCode(i)}b`)).toBe(false);
    }
  });

  it('rejects DEL (0x7f)', () => {
    expect(isSafeHeaderValue('a\x7fb')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeHeaderValue(null as unknown as string)).toBe(false);
    expect(isSafeHeaderValue(undefined as unknown as string)).toBe(false);
    expect(isSafeHeaderValue(123 as unknown as string)).toBe(false);
  });
});
