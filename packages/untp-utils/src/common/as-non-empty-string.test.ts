import { asNonEmptyString } from './as-non-empty-string.js';

describe('asNonEmptyString', () => {
  it('returns the value for a non-empty string', () => {
    expect(asNonEmptyString('foo')).toBe('foo');
    expect(asNonEmptyString(' ')).toBe(' ');
    expect(asNonEmptyString('0')).toBe('0');
  });

  it('returns undefined for the empty string', () => {
    expect(asNonEmptyString('')).toBeUndefined();
  });

  it.each([
    ['number', 0],
    ['number (non-zero)', 42],
    ['null', null],
    ['undefined', undefined],
    ['boolean true', true],
    ['boolean false', false],
    ['object', {}],
    ['array', ['a']],
    ['NaN', NaN],
  ])('returns undefined for %s', (_label, value) => {
    expect(asNonEmptyString(value)).toBeUndefined();
  });
});
