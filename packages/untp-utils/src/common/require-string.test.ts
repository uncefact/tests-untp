import type { ValidationFailure } from '../structured-error.js';
import { makeRequireString } from './require-string.js';

const CODE = 'test.missing-required-field';

describe('makeRequireString', () => {
  let failures: ValidationFailure[];
  const requireString = makeRequireString(CODE);

  beforeEach(() => {
    failures = [];
  });

  it('returns the value when it is a non-empty string', () => {
    expect(requireString('foo', 'field', '/pointer', failures)).toBe('foo');
    expect(failures).toEqual([]);
  });

  it('returns undefined and pushes a failure when the value is undefined', () => {
    expect(requireString(undefined, 'scheme.id', '/id', failures)).toBeUndefined();
    expect(failures).toEqual([
      expect.objectContaining({
        code: CODE,
        pointer: '/id',
        received: 'undefined',
        expected: 'non-empty string',
      }),
    ]);
  });

  it('returns undefined and pushes a failure when the value is the empty string (discriminated from typeof "string")', () => {
    expect(requireString('', 'scheme.name', '/name', failures)).toBeUndefined();
    expect(failures[0]).toMatchObject({ code: CODE, pointer: '/name', received: 'empty string' });
  });

  it.each([
    ['null', null, 'null'],
    ['number', 42, 'number'],
    ['boolean', true, 'boolean'],
    ['object', {}, 'object'],
    ['array', [], 'object'],
  ])('returns undefined and pushes a failure when the value is %s', (_label, value, expectedReceived) => {
    expect(requireString(value, 'field', '/p', failures)).toBeUndefined();
    expect(failures[0]).toMatchObject({ code: CODE, received: expectedReceived });
  });

  it('uses the field name in the failure message', () => {
    requireString(undefined, 'profile.criterion[2].id', '/profile/criterion/2/id', failures);
    expect(failures[0].message).toContain('profile.criterion[2].id');
  });

  it('binds the code once per factory call (different codes do not bleed across instances)', () => {
    const a = makeRequireString('foo.missing');
    const b = makeRequireString('bar.missing');
    const failuresA: ValidationFailure[] = [];
    const failuresB: ValidationFailure[] = [];
    a(undefined, 'x', '/x', failuresA);
    b(undefined, 'y', '/y', failuresB);
    expect(failuresA[0].code).toBe('foo.missing');
    expect(failuresB[0].code).toBe('bar.missing');
  });
});
