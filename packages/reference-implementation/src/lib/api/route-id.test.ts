import { containsNulByte } from './route-id';

it.each([
  ['a NUL byte', 'a\0b', true],
  ['a leading NUL byte', '\0abc', true],
  ['an ordinary id', 'abc', false],
])('identifies %s', (_description, value, expected) => {
  expect(containsNulByte(value)).toBe(expected);
});
