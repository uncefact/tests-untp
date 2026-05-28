import { isV070OrAbove } from './version';

describe('isV070OrAbove', () => {
  it.each([
    ['0.7.0', true],
    ['0.7.1', true],
    ['0.8.0', true],
    ['1.0.0', true],
    ['0.6.1', false],
    ['0.6.0', false],
    ['0.5.0', false],
    ['not-a-version', false],
  ])('returns %s -> %s', (version, expected) => {
    expect(isV070OrAbove(version)).toBe(expected);
  });
});
