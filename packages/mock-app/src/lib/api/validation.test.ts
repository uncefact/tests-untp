import { ValidationError, isNonEmptyString, validateEnum, parsePositiveInt, parseNonNegativeInt } from './validation';

describe('isNonEmptyString', () => {
  it('returns true for a non-empty string', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNonEmptyString(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isNonEmptyString(123)).toBe(false);
  });
});

describe('validateEnum', () => {
  const permitted = ['A', 'B', 'C'] as const;

  it('returns the value if it is permitted', () => {
    expect(validateEnum('A', permitted, 'field')).toBe('A');
  });

  it('returns undefined when value is undefined', () => {
    expect(validateEnum(undefined, permitted, 'field')).toBeUndefined();
  });

  it('throws ValidationError for invalid value', () => {
    expect(() => validateEnum('X', permitted, 'field')).toThrow(ValidationError);
    expect(() => validateEnum('X', permitted, 'field')).toThrow('field must be one of: A, B, C');
  });
});

describe('parsePositiveInt', () => {
  it('parses a valid positive integer', () => {
    expect(parsePositiveInt('10', 'limit')).toBe(10);
  });

  it('returns undefined for null', () => {
    expect(parsePositiveInt(null, 'limit')).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parsePositiveInt(undefined, 'limit')).toBeUndefined();
  });

  it('throws for zero', () => {
    expect(() => parsePositiveInt('0', 'limit')).toThrow(ValidationError);
    expect(() => parsePositiveInt('0', 'limit')).toThrow('limit must be a positive integer');
  });

  it('throws for negative values', () => {
    expect(() => parsePositiveInt('-1', 'limit')).toThrow(ValidationError);
  });

  it('throws for non-numeric strings', () => {
    expect(() => parsePositiveInt('abc', 'limit')).toThrow(ValidationError);
  });
});

describe('parseNonNegativeInt', () => {
  it('parses a valid non-negative integer', () => {
    expect(parseNonNegativeInt('5', 'offset')).toBe(5);
  });

  it('allows zero', () => {
    expect(parseNonNegativeInt('0', 'offset')).toBe(0);
  });

  it('returns undefined for null', () => {
    expect(parseNonNegativeInt(null, 'offset')).toBeUndefined();
  });

  it('throws for negative values', () => {
    expect(() => parseNonNegativeInt('-1', 'offset')).toThrow(ValidationError);
    expect(() => parseNonNegativeInt('-1', 'offset')).toThrow('offset must be a non-negative integer');
  });

  it('throws for non-numeric strings', () => {
    expect(() => parseNonNegativeInt('abc', 'offset')).toThrow(ValidationError);
  });
});
